import { useEffect, useState, useRef, useCallback } from 'react';
import { Send, Trash2, Bot, User, Loader2, Settings, X, Key } from 'lucide-react';
import { collaborationManager, ChatMessage } from '../lib/CollaborationManager';
import { prosemirrorToMarkdown } from '../lib/prosemirrorToMarkdown';
import { logger } from '../lib/logger';
import { supabase } from '../config/supabase';
import * as Y from 'yjs';
import './ChatSidebar.css';

// Available models
const MODELS = {
  free: [
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5', provider: 'openai', description: 'Free tier (500/day)' },
  ],
  openai: [
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', provider: 'openai', description: 'Fast & cheap' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'openai', description: 'More capable' },
    { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', description: 'Latest & best' },
  ],
  anthropic: [
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'anthropic', description: 'Fast & smart' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'anthropic', description: 'Most capable' },
  ],
};

interface ChatSidebarProps {
  isAnimating?: boolean;
  roomId: string;
}

export function ChatSidebar({ isAnimating = false, roomId }: ChatSidebarProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [, setIsLeader] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [remainingMessages, setRemainingMessages] = useState<number | null>(null);

  // API settings (stored in localStorage)
  const [userApiKey, setUserApiKey] = useState<string>(() =>
    localStorage.getItem('flashy_api_key') || ''
  );
  const [apiProvider, setApiProvider] = useState<'openai' | 'anthropic'>(() =>
    (localStorage.getItem('flashy_api_provider') as 'openai' | 'anthropic') || 'openai'
  );
  const [selectedModel, setSelectedModel] = useState<string>(() =>
    localStorage.getItem('flashy_model') || 'gpt-3.5-turbo'
  );

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const yTextRef = useRef<Y.Text | null>(null);
  const yArrayRef = useRef<Y.Array<ChatMessage> | null>(null);
  const providerRef = useRef<any>(null);
  const isSendingRef = useRef(false);
  const respondedMessagesRef = useRef<Set<string>>(new Set());

  // Save settings to localStorage
  useEffect(() => {
    localStorage.setItem('flashy_api_key', userApiKey);
    localStorage.setItem('flashy_api_provider', apiProvider);
    localStorage.setItem('flashy_model', selectedModel);
  }, [userApiKey, apiProvider, selectedModel]);

  // Get available models based on whether user has API key
  const getAvailableModels = () => {
    if (!userApiKey) return MODELS.free;
    return apiProvider === 'anthropic' ? MODELS.anthropic : MODELS.openai;
  };

  // Keep isSendingRef in sync
  useEffect(() => {
    isSendingRef.current = isSending;
  }, [isSending]);

  // Scroll to bottom when messages change
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Handle leader responding to a user message (called by observer)
  const handleLeaderResponse = useCallback(async (userMsg: ChatMessage, yArray: Y.Array<ChatMessage>) => {
    // Check if we've already responded to this message
    if (respondedMessagesRef.current.has(userMsg.id)) return;
    respondedMessagesRef.current.add(userMsg.id);

    setIsSending(true);
    setError(null);

    try {
      // Get current document content for context
      const { ydoc } = await collaborationManager.connect();
      const yXmlFragment = ydoc.getXmlFragment('prosemirror');
      const documentContent = prosemirrorToMarkdown(yXmlFragment);

      // Prepare messages for API (last 10 messages for context)
      const contextMessages = yArray.toArray().slice(-10).map(msg => ({
        role: msg.role,
        content: msg.content,
      }));

      // Call Supabase Edge Function
      const { data, error: fnError } = await supabase.functions.invoke('chat', {
        body: {
          messages: contextMessages,
          documentContent: documentContent,
          userApiKey: userApiKey || undefined,
          provider: apiProvider,
          model: selectedModel,
          roomId: roomId,
        },
      });

      if (fnError) throw fnError;

      if (data.remaining !== undefined) {
        setRemainingMessages(data.remaining);
      }

      const assistantMessage: ChatMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role: 'assistant',
        content: data.content || 'Sorry, I could not generate a response.',
        timestamp: Date.now(),
      };

      yArray.push([assistantMessage]);
    } catch (err: any) {
      logger.error('Chat API error:', err);

      const errorData = err.context?.body ? JSON.parse(err.context.body) : null;
      if (errorData?.rateLimited) {
        setRemainingMessages(0);
        setError('Daily limit reached. Add your API key for unlimited access.');
      } else {
        setError(err.message || 'Failed to get AI response');
      }

      const errorMessage: ChatMessage = {
        id: `msg-${Date.now()}-error`,
        role: 'assistant',
        content: errorData?.rateLimited
          ? 'Daily free limit reached (500 messages). Click the settings button to add your own API key for unlimited access!'
          : `Error: ${err.message || 'Failed to get AI response. Please try again.'}`,
        timestamp: Date.now(),
      };
      yArray.push([errorMessage]);
    } finally {
      setIsSending(false);
    }
  }, [userApiKey, apiProvider, selectedModel, roomId]);

  // Initialize Yjs bindings
  useEffect(() => {
    let cleanup: (() => void) | null = null;

    (async () => {
      try {
        const { provider } = await collaborationManager.connect();
        providerRef.current = provider;

        const yText = collaborationManager.getChatPrompt();
        const yArray = collaborationManager.getChatMessages();

        if (!yText || !yArray) {
          logger.error('Chat structures not available');
          return;
        }

        yTextRef.current = yText;
        yArrayRef.current = yArray;

        // Initialize prompt from Y.Text
        setPrompt(yText.toString());

        // Initialize messages from Y.Array
        setMessages(yArray.toArray());

        // Observe Y.Text changes (collaborative prompt editing)
        const textObserver = () => {
          setPrompt(yText.toString());
        };
        yText.observe(textObserver);

        // Observe Y.Array changes (new messages)
        // Leader also checks if there's a pending user message needing a response
        const arrayObserver = () => {
          const newMessages = yArray.toArray();
          setMessages(newMessages);

          // If we're the leader and the last message is from a user (not assistant),
          // and we're not already sending, make the API call
          // This handles the case where another user sends a message
          if (newMessages.length > 0) {
            const lastMsg = newMessages[newMessages.length - 1];
            if (lastMsg.role === 'user' && !isSendingRef.current && !respondedMessagesRef.current.has(lastMsg.id)) {
              // Check if we're the leader
              const states = provider.awareness.getStates();
              const clientIds = Array.from(states.keys());
              const myId = provider.awareness.clientID;
              if (!clientIds.includes(myId)) clientIds.push(myId);
              const leader = Math.min(...clientIds);

              if (myId === leader) {
                // We're the leader and there's an unanswered user message
                // Trigger the response (with a small delay to avoid race conditions)
                setTimeout(() => handleLeaderResponse(lastMsg, yArray), 100);
              }
            }
          }
        };
        yArray.observe(arrayObserver);

        // Leader election: lowest clientID is the leader
        const updateLeaderStatus = () => {
          const states = provider.awareness.getStates();
          const clientIds = Array.from(states.keys());
          const myId = provider.awareness.clientID;

          // Always include ourselves in the check
          if (!clientIds.includes(myId)) {
            clientIds.push(myId);
          }

          const leader = Math.min(...clientIds);
          const amLeader = myId === leader;
          setIsLeader(amLeader);
        };

        // Initial leader check with small delay to let awareness sync
        setTimeout(updateLeaderStatus, 500);

        // Re-check leader on awareness changes
        provider.awareness.on('change', updateLeaderStatus);

        cleanup = () => {
          yText.unobserve(textObserver);
          yArray.unobserve(arrayObserver);
          provider.awareness.off('change', updateLeaderStatus);
          collaborationManager.disconnect();
        };
      } catch (error) {
        logger.error('Failed to connect ChatSidebar:', error);
      }
    })();

    return () => {
      if (cleanup) cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle prompt input change
  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;

    if (yTextRef.current) {
      // Calculate the diff and apply to Y.Text
      const yText = yTextRef.current;
      const oldValue = yText.toString();

      // Simple diff: delete all, insert new
      // (For production, use a proper diff algorithm)
      yText.doc?.transact(() => {
        yText.delete(0, oldValue.length);
        yText.insert(0, newValue);
      });
    }
  };

  // Handle send message
  // Just adds the user message - the leader observer will handle the API call
  const handleSend = () => {
    if (!prompt.trim() || isSending) return;

    const yText = yTextRef.current;
    const yArray = yArrayRef.current;
    const userInfo = collaborationManager.getUserInfo();

    if (!yText || !yArray || !userInfo) return;

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: 'user',
      content: prompt.trim(),
      author: { name: userInfo.name, color: userInfo.color },
      timestamp: Date.now(),
    };

    // Clear prompt and add user message (all clients do this)
    // The Y.Array observer will detect the new message and the leader will respond
    yText.doc?.transact(() => {
      yText.delete(0, yText.toString().length);
    });
    yArray.push([userMessage]);
  };

  // Handle Enter key to send (Shift+Enter for newline)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Clear chat
  const handleClear = () => {
    const yArray = yArrayRef.current;
    if (yArray && yArray.length > 0) {
      yArray.delete(0, yArray.length);
    }
  };

  return (
    <div className={`chat-sidebar ${isAnimating ? 'animating' : ''}`}>
      <div className="chat-header">
        <div className="chat-title-row">
          <h3>AI Chat</h3>
          <span className="chat-status">
            {isSending
              ? 'Thinking...'
              : !userApiKey && remainingMessages !== null
                ? `${remainingMessages} free left`
                : `${messages.length} messages`}
          </span>
        </div>
        <div className="chat-toolbar">
          <button
            className={`chat-settings-button ${userApiKey ? 'has-key' : ''}`}
            onClick={() => setShowSettings(!showSettings)}
            title={userApiKey ? `Using ${apiProvider} API key` : 'Add API key for more models'}
          >
            {userApiKey ? <Key size={16} /> : <Settings size={16} />}
            {userApiKey ? selectedModel.split('-').slice(0, 2).join('-') : 'Free'}
          </button>
          <button
            className="chat-clear-button"
            onClick={handleClear}
            disabled={messages.length === 0}
            title="Clear chat"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="chat-settings-panel">
          <div className="chat-settings-header">
            <h4>AI Settings</h4>
            <button className="chat-settings-close" onClick={() => setShowSettings(false)}>
              <X size={16} />
            </button>
          </div>

          <div className="chat-settings-section">
            <label>API Provider</label>
            <div className="chat-provider-buttons">
              <button
                className={`chat-provider-btn ${apiProvider === 'openai' ? 'active' : ''}`}
                onClick={() => {
                  setApiProvider('openai');
                  setSelectedModel('gpt-3.5-turbo');
                }}
              >
                OpenAI
              </button>
              <button
                className={`chat-provider-btn ${apiProvider === 'anthropic' ? 'active' : ''}`}
                onClick={() => {
                  setApiProvider('anthropic');
                  setSelectedModel('claude-3-5-haiku-20241022');
                }}
                disabled={!userApiKey}
                title={!userApiKey ? 'Add API key to use Anthropic' : ''}
              >
                Anthropic
              </button>
            </div>
          </div>

          <div className="chat-settings-section">
            <label>Your API Key (optional)</label>
            <input
              type="password"
              className="chat-api-input"
              placeholder={apiProvider === 'openai' ? 'sk-...' : 'sk-ant-...'}
              value={userApiKey}
              onChange={(e) => setUserApiKey(e.target.value)}
            />
            <span className="chat-settings-hint">
              {userApiKey
                ? 'Using your key - unlimited access'
                : 'Free tier: 500 messages/day with GPT-3.5'}
            </span>
          </div>

          <div className="chat-settings-section">
            <label>Model</label>
            <select
              className="chat-model-select"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
            >
              {getAvailableModels().map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name} - {model.description}
                </option>
              ))}
            </select>
          </div>

          {userApiKey && (
            <button
              className="chat-clear-key-btn"
              onClick={() => {
                setUserApiKey('');
                setSelectedModel('gpt-3.5-turbo');
                setApiProvider('openai');
              }}
            >
              Clear API Key
            </button>
          )}
        </div>
      )}

      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <Bot size={48} strokeWidth={1.5} />
            <p>Start a conversation with AI</p>
            <p className="chat-empty-hint">Everyone in this session can see and contribute to the chat</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`chat-message ${msg.role === 'user' ? 'user' : 'assistant'}`}
            >
              <div className="chat-message-header">
                {msg.role === 'user' ? (
                  <>
                    <div
                      className="chat-message-avatar"
                      style={{ backgroundColor: msg.author?.color || '#B399D4' }}
                    >
                      <User size={14} />
                    </div>
                    <span className="chat-message-author">{msg.author?.name || 'User'}</span>
                  </>
                ) : (
                  <>
                    <div className="chat-message-avatar assistant">
                      <Bot size={14} />
                    </div>
                    <span className="chat-message-author">AI Assistant</span>
                  </>
                )}
              </div>
              <div className="chat-message-content">{msg.content}</div>
            </div>
          ))
        )}
        {isSending && (
          <div className="chat-message assistant">
            <div className="chat-message-header">
              <div className="chat-message-avatar assistant">
                <Bot size={14} />
              </div>
              <span className="chat-message-author">AI Assistant</span>
            </div>
            <div className="chat-message-content typing">
              <Loader2 size={16} className="spinning" />
              <span>Thinking...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {error && (
        <div className="chat-error">
          {error}
        </div>
      )}

      <div className="chat-input-area">
        <textarea
          ref={textareaRef}
          className="chat-input"
          placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
          value={prompt}
          onChange={handlePromptChange}
          onKeyDown={handleKeyDown}
          disabled={isSending}
          rows={3}
        />
        <button
          className="chat-send-button"
          onClick={handleSend}
          disabled={!prompt.trim() || isSending}
          title="Send message"
        >
          {isSending ? <Loader2 size={20} className="spinning" /> : <Send size={20} />}
        </button>
      </div>
    </div>
  );
}
