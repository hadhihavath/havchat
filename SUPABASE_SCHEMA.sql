-- ==========================================
-- HAVCHAT SUPABASE DATABASE SCHEMA
-- Copy and run this script in your Supabase SQL Editor
-- ==========================================

-- 1. Create Profiles Table (extends Supabase auth.users)
CREATE TABLE public.profiles (
    id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    avatar_url TEXT,
    online_status TEXT DEFAULT 'offline' CHECK (online_status IN ('online', 'offline')),
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- Enable Realtime for Profiles
ALTER TABLE public.profiles REPLICA IDENTITY FULL;

-- 2. Create Messages Table (Group Chat and 1-on-1 DMs)
CREATE TABLE public.messages (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sender_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    recipient_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE, -- NULL means group chat
    content TEXT,
    file_url TEXT,
    file_name TEXT,
    file_type TEXT DEFAULT 'text' CHECK (file_type IN ('text', 'image', 'video', 'voice', 'file')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 3. Create Calls Table (Handles call connection status)
CREATE TABLE public.calls (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    caller_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    receiver_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ringing', 'connected', 'ended', 'rejected')),
    type TEXT NOT NULL CHECK (type IN ('audio', 'video')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 4. Create Call Signaling Table (Exchanges WebRTC SDP / ICE Candidates)
CREATE TABLE public.call_signaling (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    call_id UUID REFERENCES public.calls(id) ON DELETE CASCADE NOT NULL,
    sender_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('offer', 'answer', 'candidate')),
    payload JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- ==========================================
-- TRIGGERS & FUNCTIONS
-- ==========================================

-- A. Auto-create Profile on Sign-up & Enforce 5-Member limit
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if we already have 5 members registered
    IF (SELECT COUNT(*) FROM public.profiles) >= 5 THEN
        RAISE EXCEPTION 'Registration is locked: HAVCHAT is limited to exactly 5 members.';
    END IF;

    INSERT INTO public.profiles (id, username, avatar_url)
    VALUES (
        new.id,
        COALESCE(new.raw_user_meta_data->>'username', 'User ' || substring(new.id::text from 1 for 4)),
        new.raw_user_meta_data->>'avatar_url'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to run after a user signs up
CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- B. Sync status to offline when user logs out or stops heartbeat (Optional, client handles status updates)
CREATE OR REPLACE FUNCTION public.update_profile_last_seen()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.profiles
    SET last_seen = NOW()
    WHERE id = new.sender_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER on_message_sent
    AFTER INSERT ON public.messages
    FOR EACH ROW EXECUTE FUNCTION public.update_profile_last_seen();


-- ==========================================
-- REALTIME SETTINGS
-- ==========================================
-- Enable real-time updates for profiles, messages, calls, and call_signaling
begin;
  -- Remove existing publications
  drop publication if exists supabase_realtime;
  
  -- Create new publication for real-time tables
  create publication supabase_realtime for table 
    public.profiles, 
    public.messages, 
    public.calls, 
    public.call_signaling;
commit;


-- ==========================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==========================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_signaling ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
CREATE POLICY "Public profiles are readable by everyone" ON public.profiles
    FOR SELECT USING (true);

CREATE POLICY "Users can update their own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

-- Messages Policies
CREATE POLICY "Messages are readable by everyone authenticated" ON public.messages
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert messages" ON public.messages
    FOR INSERT WITH CHECK (auth.uid() = sender_id);

-- Calls Policies
CREATE POLICY "Calls are readable by members involved" ON public.calls
    FOR SELECT USING (auth.uid() = caller_id OR auth.uid() = receiver_id);

CREATE POLICY "Users can insert calls" ON public.calls
    FOR INSERT WITH CHECK (auth.uid() = caller_id);

CREATE POLICY "Users can update calls they are part of" ON public.calls
    FOR UPDATE USING (auth.uid() = caller_id OR auth.uid() = receiver_id);

-- Call Signaling Policies
CREATE POLICY "Signaling is readable by members" ON public.call_signaling
    FOR SELECT USING (
        auth.uid() IN (
            SELECT caller_id FROM public.calls WHERE id = call_id
            UNION
            SELECT receiver_id FROM public.calls WHERE id = call_id
        )
    );

CREATE POLICY "Users can insert signaling payload" ON public.call_signaling
    FOR INSERT WITH CHECK (auth.uid() = sender_id);

-- ==========================================
-- STORAGE BUCKETS SETUP INSTRUCTIONS
-- ==========================================
-- In the Supabase Dashboard -> Storage section:
-- 1. Create a public bucket named "havchat-files".
-- 2. Add an Allowed MIME type wildcard "*/*" if you want all file types.
-- 3. Set the following RLS Policies for Storage.objects:
--    - "Allow public read access": For SELECT on storage.objects, Target: Everyone, Policy: bucket_id = 'havchat-files'
--    - "Allow authenticated upload": For INSERT on storage.objects, Target: Authenticated, Policy: bucket_id = 'havchat-files'
--    - "Allow authenticated delete": For DELETE on storage.objects, Target: Authenticated, Policy: bucket_id = 'havchat-files' AND owner = auth.uid()
