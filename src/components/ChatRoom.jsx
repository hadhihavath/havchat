import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { Send, Paperclip, Mic, X, File, Image, Video, Phone, Video as VideoIcon, Play } from 'lucide-react';

export default function ChatRoom({ currentUser, activeChat, onInitiateCall }) {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileType, setFileType] = useState('text'); // 'text', 'image', 'video', 'file'
  const [uploading, setUploading] = useState(false);
  const [lightboxImage, setLightboxImage] = useState(null);
  
  // Voice Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [audioChunks, setAudioChunks] = useState([]);

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  // Load profile names for quick formatting in messages
  const [profiles, setProfiles] = useState({});

  useEffect(() => {
    fetchProfiles();
    fetchMessages();

    // Subscribe to new messages realtime
    const messageChannel = supabase
      .channel('public:messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        handleNewIncomingMessage(payload.new);
      })
      .subscribe();

    return () => {
      messageChannel.unsubscribe();
    };
  }, [activeChat, currentUser]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const fetchProfiles = async () => {
    const { data, error } = await supabase.from('profiles').select('id, username, avatar_url');
    if (!error && data) {
      const profMap = {};
      data.forEach((p) => {
        profMap[p.id] = p;
      });
      setProfiles(profMap);
    }
  };

  const fetchMessages = async () => {
    try {
      let query = supabase
        .from('messages')
        .select('*')
        .order('created_at', { ascending: true });

      if (activeChat.type === 'group') {
        // Group chat - recipient_id is null
        query = query.is('recipient_id', null);
      } else {
        // DM between currentUser and activeChat.id
        query = query.or(
          `and(sender_id.eq.${currentUser.id},recipient_id.eq.${activeChat.id}),and(sender_id.eq.${activeChat.id},recipient_id.eq.${currentUser.id})`
        );
      }

      const { data, error } = await query;
      if (error) throw error;
      setMessages(data || []);
    } catch (err) {
      console.error('Error fetching messages:', err);
    }
  };

  const handleNewIncomingMessage = (newMsg) => {
    // If it's a group chat message and we are in group chat
    if (activeChat.type === 'group' && newMsg.recipient_id === null) {
      setMessages((prev) => [...prev, newMsg]);
    }
    // If it's a DM message between us and the sender/recipient
    else if (activeChat.type === 'dm') {
      const isRelevant =
        (newMsg.sender_id === currentUser.id && newMsg.recipient_id === activeChat.id) ||
        (newMsg.sender_id === activeChat.id && newMsg.recipient_id === currentUser.id);
      if (isRelevant) {
        setMessages((prev) => [...prev, newMsg]);
      }
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const triggerFileSelect = () => {
    fileInputRef.current.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setSelectedFile(file);

    // Determine type
    if (file.type.startsWith('image/')) {
      setFileType('image');
    } else if (file.type.startsWith('video/')) {
      setFileType('video');
    } else {
      setFileType('file');
    }
  };

  const uploadFile = async (file) => {
    // Create folder structure containing unique ID but preserving original name
    const uniqueId = crypto.randomUUID();
    const cleanFileName = file.name.replace(/[^\x00-\x7F]/g, ''); // standard ascii clean
    const filePath = `uploads/${uniqueId}/${cleanFileName}`;

    const { data, error } = await supabase.storage
      .from('havchat-files')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (error) throw error;

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('havchat-files')
      .getPublicUrl(filePath);

    return {
      publicUrl: urlData.publicUrl,
      fileName: file.name,
    };
  };

  const handleSend = async (e) => {
    if (e) e.preventDefault();
    if (!inputText.trim() && !selectedFile && !uploading) return;

    setUploading(true);
    let fileUrl = null;
    let finalFileName = null;
    let finalFileType = fileType;

    try {
      if (selectedFile) {
        const uploadResult = await uploadFile(selectedFile);
        fileUrl = uploadResult.publicUrl;
        finalFileName = uploadResult.fileName;
      }

      const { error } = await supabase.from('messages').insert({
        sender_id: currentUser.id,
        recipient_id: activeChat.type === 'dm' ? activeChat.id : null,
        content: inputText.trim() || null,
        file_url: fileUrl,
        file_name: finalFileName,
        file_type: finalFileName ? finalFileType : 'text',
      });

      if (error) throw error;

      setInputText('');
      setSelectedFile(null);
      setFileType('text');
    } catch (err) {
      alert('Error sending message: ' + err.message);
    } finally {
      setUploading(false);
    }
  };

  // Voice recording handlers
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      let chunks = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(chunks, { type: 'audio/webm' });
        const audioFile = new File([audioBlob], `voice_message_${Date.now()}.webm`, {
          type: 'audio/webm',
        });

        setUploading(true);
        try {
          const uploadResult = await uploadFile(audioFile);
          
          const { error } = await supabase.from('messages').insert({
            sender_id: currentUser.id,
            recipient_id: activeChat.type === 'dm' ? activeChat.id : null,
            content: '',
            file_url: uploadResult.publicUrl,
            file_name: uploadResult.fileName,
            file_type: 'voice',
          });

          if (error) throw error;
        } catch (err) {
          alert('Failed to send voice recording: ' + err.message);
        } finally {
          setUploading(false);
          // Stop stream tracks
          stream.getTracks().forEach((track) => track.stop());
        }
      };

      setMediaRecorder(recorder);
      setAudioChunks([]);
      recorder.start();
      setIsRecording(true);
    } catch (err) {
      alert('Could not access microphone: ' + err.message);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      setIsRecording(false);
    }
  };

  const cancelRecording = () => {
    if (mediaRecorder) {
      mediaRecorder.onstop = null; // discard trigger
      mediaRecorder.stop();
      setIsRecording(false);
    }
  };

  const getSenderName = (senderId) => {
    if (senderId === currentUser.id) return 'You';
    return profiles[senderId]?.username || 'Member';
  };

  const getFormattedSize = (bytes) => {
    if (!bytes) return '';
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(2))} ${sizes[i]}`;
  };

  return (
    <div className="chat-room">
      <header className="chat-header">
        <div className="chat-header-info">
          <div>
            <h3 style={{ fontWeight: 600 }}>{activeChat.name}</h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              {activeChat.type === 'group' ? '5 members space' : 'Direct Message'}
            </span>
          </div>
        </div>

        {activeChat.type === 'dm' && activeChat.profile && (
          <div className="chat-header-actions">
            <button
              onClick={() => onInitiateCall(activeChat.profile, 'audio')}
              className="action-btn call-audio"
              style={{ width: '40px', height: '40px', background: 'rgba(255,255,255,0.03)', borderRadius: '50%' }}
            >
              <Phone size={18} />
            </button>
            <button
              onClick={() => onInitiateCall(activeChat.profile, 'video')}
              className="action-btn call-video"
              style={{ width: '40px', height: '40px', background: 'rgba(255,255,255,0.03)', borderRadius: '50%' }}
            >
              <VideoIcon size={18} />
            </button>
          </div>
        )}
      </header>

      {/* Messages Feed */}
      <div className="messages-list">
        {messages.length === 0 ? (
          <div style={{ margin: 'auto', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            No messages yet. Send a message to start the conversation!
          </div>
        ) : (
          messages.map((msg) => {
            const isSentByMe = msg.sender_id === currentUser.id;
            const timeString = new Date(msg.created_at).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <div key={msg.id} className={`message-item ${isSentByMe ? 'sent' : 'received'}`}>
                {activeChat.type === 'group' && !isSentByMe && (
                  <span className="message-sender">{getSenderName(msg.sender_id)}</span>
                )}
                <div className="message-bubble">
                  {/* Text content if available */}
                  {msg.content && <p>{msg.content}</p>}

                  {/* Render attachments */}
                  {msg.file_type === 'image' && (
                    <img
                      src={msg.file_url}
                      alt={msg.file_name}
                      className="message-media-image"
                      onClick={() => setLightboxImage(msg.file_url)}
                    />
                  )}

                  {msg.file_type === 'video' && (
                    <video
                      src={msg.file_url}
                      className="message-media-video"
                      controls
                      playsInline
                    />
                  )}

                  {msg.file_type === 'voice' && (
                    <audio
                      src={msg.file_url}
                      className="message-media-audio"
                      controls
                    />
                  )}

                  {msg.file_type === 'file' && (
                    <a
                      href={msg.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="message-file-attachment"
                      download={msg.file_name}
                    >
                      <File size={24} style={{ color: 'var(--accent-primary)' }} />
                      <div className="file-attachment-info">
                        <span className="file-attachment-name">{msg.file_name}</span>
                        <span className="file-attachment-size">Raw File</span>
                      </div>
                    </a>
                  )}

                  <span className="message-time">{timeString}</span>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input panel */}
      <div className="chat-input-bar">
        {selectedFile && (
          <div className="attachment-preview">
            <div className="attachment-preview-info">
              {fileType === 'image' ? <Image size={18} /> : fileType === 'video' ? <Video size={18} /> : <File size={18} />}
              <span className="attachment-preview-name">{selectedFile.name} (Original Size)</span>
            </div>
            <button onClick={() => setSelectedFile(null)} className="attachment-preview-cancel">
              <X size={16} />
            </button>
          </div>
        )}

        <div className="chat-input-wrapper">
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />

          {!isRecording ? (
            <>
              <button
                type="button"
                onClick={triggerFileSelect}
                className="chat-input-action"
                disabled={uploading}
                title="Attach Files (Raw/No Compression)"
              >
                <Paperclip size={20} />
              </button>

              <form onSubmit={handleSend} style={{ display: 'flex', flex: 1, gap: '12px' }}>
                <input
                  type="text"
                  className="chat-text-input"
                  placeholder={uploading ? "Uploading attachment..." : "Type your message..."}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  disabled={uploading}
                />
                {(inputText.trim() || selectedFile) && (
                  <button type="submit" className="chat-input-action send-btn" disabled={uploading}>
                    <Send size={18} />
                  </button>
                )}
              </form>

              {!inputText.trim() && !selectedFile && (
                <button
                  type="button"
                  onClick={startRecording}
                  className="chat-input-action"
                  title="Record Voice Message"
                  disabled={uploading}
                >
                  <Mic size={20} />
                </button>
              )}
            </>
          ) : (
            <div className="voice-recording-overlay">
              <div className="recording-status">
                <span className="recording-pulse" />
                <span>Recording Voice Message...</span>
              </div>
              <div className="wave-bar-container">
                <span className="wave-bar" />
                <span className="wave-bar" />
                <span className="wave-bar" />
                <span className="wave-bar" />
                <span className="wave-bar" />
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={cancelRecording} className="action-btn" style={{ color: '#ff4a4a' }}>
                  Cancel
                </button>
                <button onClick={stopRecording} className="action-btn" style={{ color: '#22c55e', fontWeight: 600 }}>
                  Send
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Lightbox for high-quality images */}
      {lightboxImage && (
        <div className="lightbox" onClick={() => setLightboxImage(null)}>
          <img src={lightboxImage} alt="Raw preview" className="lightbox-content" />
        </div>
      )}
    </div>
  );
}
