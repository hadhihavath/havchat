import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import Auth from './components/Auth';
import MemberStatus from './components/MemberStatus';
import ChatRoom from './components/ChatRoom';
import CallScreen from './components/CallScreen';
import { MessageSquare } from 'lucide-react';

export default function App() {
  const [sessionUser, setSessionUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeChat, setActiveChat] = useState({
    type: 'group',
    id: 'global',
    name: 'Global Space',
  });
  const [activeCall, setActiveCall] = useState(null); // call info object

  useEffect(() => {
    // Check initial auth state
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSessionUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSessionUser(session?.user ?? null);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Setup incoming call listener when user is logged in
  useEffect(() => {
    if (!sessionUser) return;

    // Listen to new calls where this user is the receiver
    const callsChannel = supabase
      .channel('public:calls_incoming')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'calls',
          filter: `receiver_id=eq.${sessionUser.id}`,
        },
        async (payload) => {
          const newCall = payload.new;
          if (newCall.status === 'ringing') {
            // Fetch caller profile for username display
            const { data: profile } = await supabase
              .from('profiles')
              .select('username')
              .eq('id', newCall.caller_id)
              .single();

            setActiveCall({
              id: newCall.id,
              role: 'receiver',
              type: newCall.type,
              status: 'ringing',
              callerId: newCall.caller_id,
              otherMemberName: profile?.username || 'Member',
            });
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'calls',
          filter: `receiver_id=eq.${sessionUser.id}`,
        },
        (payload) => {
          const updatedCall = payload.new;
          if (updatedCall.status === 'ended' || updatedCall.status === 'rejected') {
            setActiveCall(null);
          }
        }
      )
      .subscribe();

    return () => {
      callsChannel.unsubscribe();
    };
  }, [sessionUser]);

  const handleInitiateCall = async (targetMember, callType) => {
    if (!sessionUser) return;

    try {
      // 1. Create a row in the calls table
      const { data, error } = await supabase
        .from('calls')
        .insert({
          caller_id: sessionUser.id,
          receiver_id: targetMember.id,
          type: callType,
          status: 'ringing',
        })
        .select()
        .single();

      if (error) throw error;

      // 2. Open Call Screen as caller
      setActiveCall({
        id: data.id,
        role: 'caller',
        type: callType,
        status: 'ringing',
        receiverId: targetMember.id,
        otherMemberName: targetMember.username,
      });
    } catch (err) {
      alert('Failed to start call: ' + err.message);
    }
  };

  const handleCallEnd = () => {
    setActiveCall(null);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', justifyContent: 'center', alignItems: 'center', backgroundColor: '#0b0d19' }}>
        <div style={{ fontSize: '1.2rem', color: '#00f2fe', letterSpacing: '1px' }}>
          Loading HAVCHAT...
        </div>
      </div>
    );
  }

  if (!sessionUser) {
    return <Auth onAuthSuccess={(user) => setSessionUser(user)} />;
  }

  return (
    <div className="app-container">
      {/* Sidebar for members and rooms */}
      <MemberStatus
        currentUser={sessionUser}
        activeChat={activeChat}
        onChatSelect={(chat) => setActiveChat(chat)}
        onInitiateCall={handleInitiateCall}
      />

      {/* Main Chat Workspace */}
      {activeChat ? (
        <ChatRoom
          key={`${activeChat.type}-${activeChat.id}`}
          currentUser={sessionUser}
          activeChat={activeChat}
          onInitiateCall={handleInitiateCall}
        />
      ) : (
        <div className="no-chat-selected">
          <div className="no-chat-icon">
            <MessageSquare size={36} />
          </div>
          <h3>Welcome to HAVCHAT</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Select a space or contact to start talking.
          </p>
        </div>
      )}

      {/* WebRTC Video/Audio Call Overlay Screen */}
      {activeCall && (
        <CallScreen
          currentUser={sessionUser}
          activeCall={activeCall}
          onCallEnd={handleCallEnd}
        />
      )}
    </div>
  );
}
