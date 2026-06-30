import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

export default function Auth({ onAuthSuccess }) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [memberCount, setMemberCount] = useState(0);

  useEffect(() => {
    fetchMemberCount();
  }, []);

  const fetchMemberCount = async () => {
    try {
      const { count, error } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true });

      if (!error) {
        setMemberCount(count || 0);
      }
    } catch (err) {
      console.error('Error fetching profiles count:', err);
    }
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isSignUp) {
        // Enforce client-side check for 5 members limit
        const { count, error: countErr } = await supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true });

        if (countErr) throw countErr;
        if ((count || 0) >= 5) {
          throw new Error('Registration is locked: HAVCHAT has reached its 5-member limit.');
        }

        if (!username.trim()) {
          throw new Error('Username is required.');
        }

        // Generate a random high-quality pixel avatar if none provided
        const finalAvatar = avatarUrl.trim() || `https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${encodeURIComponent(username)}`;

        const { data, error: signUpErr } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              username: username.trim(),
              avatar_url: finalAvatar,
            },
          },
        });

        if (signUpErr) throw signUpErr;

        if (data?.user && (!data.session)) {
          setError('Signup successful! Check your email for verification link (if email verification is enabled in Supabase). Otherwise, you can now try logging in.');
        } else if (data?.session) {
          onAuthSuccess(data.session.user);
        }
      } else {
        const { data, error: loginErr } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (loginErr) throw loginErr;
        if (data?.session) {
          onAuthSuccess(data.session.user);
        }
      }
    } catch (err) {
      setError(err.message || 'An error occurred during authentication.');
    } finally {
      setLoading(false);
      fetchMemberCount();
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card glass-panel">
        <div>
          <h1 className="auth-logo">HAVCHAT</h1>
          <p className="auth-subtitle">
            {isSignUp ? 'Join the exclusive 5-member space' : 'Welcome back to HAVCHAT'}
          </p>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '8px' }}>
            Current Members: <strong style={{ color: 'var(--accent-primary)' }}>{memberCount}/5</strong>
          </div>
        </div>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={handleAuth} className="auth-form">
          {isSignUp && (
            <>
              <div className="form-group">
                <label className="form-label">Username</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. shadow_walker"
                  className="form-input"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Avatar URL (Optional)</label>
                <input
                  type="url"
                  placeholder="https://example.com/avatar.jpg"
                  className="form-input"
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  disabled={loading}
                />
              </div>
            </>
          )}

          <div className="form-group">
            <label className="form-label">Email Address</label>
            <input
              type="email"
              required
              placeholder="name@example.com"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              type="password"
              required
              placeholder="••••••••"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </div>

          <button type="submit" className="auth-btn" disabled={loading}>
            {loading ? 'Processing...' : isSignUp ? 'Sign Up' : 'Log In'}
          </button>
        </form>

        <button
          onClick={() => {
            setIsSignUp(!isSignUp);
            setError(null);
          }}
          className="auth-toggle"
          disabled={loading}
        >
          {isSignUp ? 'Already a member? Log In' : 'Need an account? Sign Up'}
        </button>
      </div>
    </div>
  );
}
