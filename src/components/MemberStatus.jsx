import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { LogOut, Video, Phone, Users, MessageSquare } from 'lucide-react';

export default function MemberStatus({ currentUser, activeChat, onChatSelect, onInitiateCall }) {
  const [members, setMembers] = useState([]);
  const [currentUserProfile, setCurrentUserProfile] = useState(null);

  useEffect(() => {
    fetchMembers();

    // Set online status in database
    updateOnlineStatus('online');

    // Subscribe to profile changes (status, avatar, etc.)
    const profilesSubscription = supabase
      .channel('public:profiles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, (payload) => {
        handleProfileChange(payload);
      })
      .subscribe();

    // Cleanup
    return () => {
      profilesSubscription.unsubscribe();
      updateOnlineStatus('offline');
    };
  }, [currentUser]);

  const updateOnlineStatus = async (status) => {
    if (!currentUser) return;
    try {
      await supabase
        .from('profiles')
        .update({ online_status: status, last_seen: new Date().toISOString() })
        .eq('id', currentUser.id);
    } catch (err) {
      console.error('Error updating status:', err);
    }
  };

  const fetchMembers = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('username', { ascending: true });

      if (error) throw error;
      setMembers(data || []);

      const current = data.find((m) => m.id === currentUser.id);
      if (current) setCurrentUserProfile(current);
    } catch (err) {
      console.error('Error fetching members:', err);
    }
  };

  const handleProfileChange = (payload) => {
    const { eventType, new: newRow, old: oldRow } = payload;
    setMembers((prev) => {
      const exists = prev.some((m) => m.id === newRow.id);
      if (eventType === 'INSERT') {
        if (exists) return prev;
        return [...prev, newRow].sort((a, b) => a.username.localeCompare(b.username));
      } else if (eventType === 'UPDATE') {
        if (newRow.id === currentUser.id) {
          setCurrentUserProfile(newRow);
        }
        return prev.map((m) => (m.id === newRow.id ? newRow : m));
      } else if (eventType === 'DELETE') {
        return prev.filter((m) => m.id !== oldRow.id);
      }
      return prev;
    });
  };

  const handleLogout = async () => {
    await updateOnlineStatus('offline');
    await supabase.auth.signOut();
  };

  const otherMembers = members.filter((m) => m.id !== currentUser.id);

  return (
    <aside className="sidebar glass-panel">
      <div className="sidebar-header">
        <h2 className="sidebar-logo">HAVCHAT</h2>
        <button onClick={handleLogout} className="logout-btn" title="Log Out">
          <LogOut size={20} />
        </button>
      </div>

      <div className="members-container">
        {/* Group Chat Selection */}
        <div className="section-title">Rooms</div>
        <div
          className={`group-chat-item ${activeChat.type === 'group' ? 'active' : ''}`}
          onClick={() => onChatSelect({ type: 'group', id: 'global', name: 'Global Space' })}
        >
          <div className="group-icon-wrapper">
            <Users size={20} />
          </div>
          <div className="group-info">
            <span className="group-name">Global Space</span>
            <span className="group-desc">All 5 members</span>
          </div>
        </div>

        {/* 1-on-1 Chats / Members List */}
        <div className="section-title" style={{ marginTop: '16px' }}>Direct Messages</div>
        {otherMembers.length === 0 ? (
          <div style={{ padding: '0 8px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Waiting for other members to join...
          </div>
        ) : (
          otherMembers.map((member) => {
            const isActive = activeChat.type === 'dm' && activeChat.id === member.id;
            const isOnline = member.online_status === 'online';

            return (
              <div
                key={member.id}
                className={`member-item ${isActive ? 'active' : ''}`}
                onClick={() =>
                  onChatSelect({ type: 'dm', id: member.id, name: member.username, profile: member })
                }
              >
                <div className="member-details">
                  <div className="avatar-wrapper">
                    {member.avatar_url ? (
                      <img src={member.avatar_url} alt={member.username} className="avatar" />
                    ) : (
                      <div className="avatar">
                        {member.username.substring(0, 2).toUpperCase()}
                      </div>
                    )}
                    <span className={`status-indicator ${isOnline ? 'online' : 'offline'}`} />
                  </div>
                  <div className="member-info">
                    <span className="member-name">{member.username}</span>
                    <span className="member-status-text">
                      {isOnline ? 'Active now' : 'Away'}
                    </span>
                  </div>
                </div>

                <div className="member-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="action-btn call-audio"
                    onClick={() => onInitiateCall(member, 'audio')}
                    title="Audio Call"
                  >
                    <Phone size={16} />
                  </button>
                  <button
                    className="action-btn call-video"
                    onClick={() => onInitiateCall(member, 'video')}
                    title="Video Call"
                  >
                    <Video size={16} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {currentUserProfile && (
        <div className="current-user-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div className="avatar-wrapper" style={{ width: '36px', height: '36px' }}>
              {currentUserProfile.avatar_url ? (
                <img
                  src={currentUserProfile.avatar_url}
                  alt={currentUserProfile.username}
                  className="avatar"
                  style={{ width: '36px', height: '36px' }}
                />
              ) : (
                <div className="avatar" style={{ width: '36px', height: '36px', fontSize: '0.85rem' }}>
                  {currentUserProfile.username.substring(0, 2).toUpperCase()}
                </div>
              )}
              <span className="status-indicator online" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                {currentUserProfile.username}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Logged in</span>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
