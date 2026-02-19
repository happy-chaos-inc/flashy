import { useEffect, useState, useRef, useCallback } from 'react';
import { Send, Trash2, Bot, User, Loader2, Settings, X, Key, Paperclip, FileText, Sparkles, Lightbulb, HelpCircle, Upload, ChevronDown, Plus, MessageSquare, Copy, Check } from 'lucide-react';
import { collaborationManager, ChatMessage, SharedAttachmentMeta, ChatThread } from '../lib/CollaborationManager';
import { prosemirrorToMarkdown } from '../lib/prosemirrorToMarkdown';
import { logger } from '../lib/logger';
import { supabase } from '../config/supabase';
import { Logo } from './Logo';
import * as Y from 'yjs';
import * as pdfjsLib from 'pdfjs-dist';
import './ChatSidebar.css';

// PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

// Available models
const MODELS = {
  free: [
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', description: 'Free tier (500/day)' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'anthropic', description: 'Free tier (500/day)' },
  ],
  openai: [
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', description: 'Fast & affordable' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'openai', description: 'More capable' },
    { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', description: 'Latest & best' },
  ],
  anthropic: [
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'anthropic', description: 'Fast & smart' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'anthropic', description: 'Most capable' },
  ],
};

const SUGGESTIONS = [
  { label: 'Summarize my notes', icon: FileText },
  { label: 'Generate flashcards from this page', icon: Sparkles },
  { label: 'Explain a concept', icon: Lightbulb },
  { label: 'Quiz me on this topic', icon: HelpCircle },
];

const ACCEPTED_TYPES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/pdf',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB per file
const MAX_IMAGE_DIMENSION = 1024; // resize images to fit within this

interface AttachedFile {
  file: File;
  previewUrl: string | null;
}

interface ImageAttachment {
  base64: string;
  mimeType: string;
  name: string;
}

// Extracted text from PDFs, keyed by message ID
interface PendingFileData {
  images: ImageAttachment[];
  extractedText: string;
}

function getFileCategory(file: File): 'image' | 'pdf' | 'ppt' {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type === 'application/pdf') return 'pdf';
  return 'ppt';
}

// Read file directly as base64 (no canvas — preserves valid image data)
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Get image as base64 — resize only if over the dimension limit
function processImageForApi(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const { width, height } = img;
      URL.revokeObjectURL(img.src);

      // If small enough, use original file bytes (avoids canvas re-encoding issues)
      if (width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION) {
        fileToBase64(file).then(base64 => {
          resolve({ base64, mimeType: file.type || 'image/png' });
        }).catch(reject);
        return;
      }

      // Need to resize — use canvas
      const scale = MAX_IMAGE_DIMENSION / Math.max(width, height);
      const newW = Math.round(width * scale);
      const newH = Math.round(height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = newW;
      canvas.height = newH;
      const ctx = canvas.getContext('2d')!;

      // Re-load the image for drawing (previous one's URL was revoked)
      const img2 = new Image();
      img2.onload = () => {
        ctx.drawImage(img2, 0, 0, newW, newH);
        URL.revokeObjectURL(img2.src);
        // Always output JPEG for resized images (more compatible)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
      };
      img2.onerror = reject;
      img2.src = URL.createObjectURL(file);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// Extract text from a PDF using pdf.js
async function extractPdfText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages: string[] = [];
  const maxPages = Math.min(pdf.numPages, 50); // cap at 50 pages
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((item: any) => item.str).join(' ');
    if (text.trim()) pages.push(text);
  }
  if (pdf.numPages > 50) {
    pages.push(`\n[...truncated, showing 50 of ${pdf.numPages} pages]`);
  }
  return pages.join('\n\n');
}

// Render message content with code block detection and copy buttons
function MessageContent({ content }: { content: string }) {
  const [copiedBlock, setCopiedBlock] = useState<number | null>(null);

  // Split content into text and code blocks
  const parts: Array<{ type: 'text' | 'code'; content: string; lang?: string }> = [];
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    // Text before this code block
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: content.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'code', content: match[2].trim(), lang: match[1] || undefined });
    lastIndex = match.index + match[0].length;
  }
  // Remaining text after last code block
  if (lastIndex < content.length) {
    parts.push({ type: 'text', content: content.slice(lastIndex) });
  }

  // If no code blocks found, render as plain text
  if (parts.length === 0 || (parts.length === 1 && parts[0].type === 'text')) {
    return <>{content}</>;
  }

  const handleCopy = async (text: string, blockIndex: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedBlock(blockIndex);
      setTimeout(() => setCopiedBlock(null), 2000);
    } catch {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedBlock(blockIndex);
      setTimeout(() => setCopiedBlock(null), 2000);
    }
  };

  let codeBlockCount = 0;
  return (
    <>
      {parts.map((part, i) => {
        if (part.type === 'text') {
          return <span key={i}>{part.content}</span>;
        }
        const blockIdx = codeBlockCount++;
        return (
          <div key={i} className="chat-code-block">
            <div className="chat-code-header">
              <span className="chat-code-lang">{part.lang || 'code'}</span>
              <button
                className="chat-code-copy"
                onClick={() => handleCopy(part.content, blockIdx)}
                title="Copy to clipboard"
              >
                {copiedBlock === blockIdx ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
              </button>
            </div>
            <pre className="chat-code-content"><code>{part.content}</code></pre>
          </div>
        );
      })}
    </>
  );
}

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
  const [attachments, setAttachments] = useState<AttachedFile[]>([]); // Local files in this browser
  const [sharedAttachmentsMeta, setSharedAttachmentsMeta] = useState<SharedAttachmentMeta[]>([]); // All attachments from all peers
  const [isDragOver, setIsDragOver] = useState(false);
  const [threads, setThreads] = useState<ChatThread[]>([{ id: 'default', name: 'Chat', createdAt: Date.now() }]);
  const [activeThreadId, setActiveThreadId] = useState('default');
  const [hasRagChunks, setHasRagChunks] = useState(false);

  // Per-thread presence: map of threadId -> array of {name, color} of peers in that thread
  const [threadPresence, setThreadPresence] = useState<Record<string, Array<{name: string; color: string}>>>({});
  // Typing indicators: map of threadId -> array of peer names currently typing
  const [threadTyping, setThreadTyping] = useState<Record<string, string[]>>({});

  // API settings (stored in localStorage)
  const [userApiKey, setUserApiKey] = useState<string>(() =>
    localStorage.getItem('flashy_api_key') || ''
  );
  const [apiProvider, setApiProvider] = useState<'openai' | 'anthropic'>(() =>
    (localStorage.getItem('flashy_api_provider') as 'openai' | 'anthropic') || 'openai'
  );
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    const saved = localStorage.getItem('flashy_model');
    // Validate saved model is still available
    const allModelIds = [...MODELS.free, ...MODELS.openai, ...MODELS.anthropic].map(m => m.id);
    if (saved && allModelIds.includes(saved)) return saved;
    return 'gpt-4o-mini';
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const yTextRef = useRef<Y.Text | null>(null);
  const yArrayRef = useRef<Y.Array<ChatMessage> | null>(null);
  const yAttachmentsMetaRef = useRef<Y.Array<SharedAttachmentMeta> | null>(null);
  const ySendRequestRef = useRef<Y.Map<any> | null>(null);
  const providerRef = useRef<any>(null);
  const clientIdRef = useRef<number>(0);
  const isSendingRef = useRef(false);
  const respondedMessagesRef = useRef<Set<string>>(new Set());
  const pendingFilesRef = useRef<Map<string, PendingFileData>>(new Map());
  const localFilesRef = useRef<Map<string, { file: File; processed: ImageAttachment | null; extractedText: string }>>(new Map());
  const dragCounterRef = useRef(0);
  const yThreadsRef = useRef<import('yjs').Map<any> | null>(null);

  // Keep refs in sync with state so the Y.js observer (set up once) always reads current values
  const userApiKeyRef = useRef(userApiKey);
  const apiProviderRef = useRef(apiProvider);
  const selectedModelRef = useRef(selectedModel);
  useEffect(() => { userApiKeyRef.current = userApiKey; }, [userApiKey]);
  useEffect(() => { apiProviderRef.current = apiProvider; }, [apiProvider]);
  useEffect(() => { selectedModelRef.current = selectedModel; }, [selectedModel]);

  // Save settings to localStorage
  useEffect(() => {
    localStorage.setItem('flashy_api_key', userApiKey);
    localStorage.setItem('flashy_api_provider', apiProvider);
    localStorage.setItem('flashy_model', selectedModel);
  }, [userApiKey, apiProvider, selectedModel]);

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      attachments.forEach(a => {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      // Check for pending file data for this message
      const pendingFiles = pendingFilesRef.current.get(userMsg.id);
      logger.log('[Chat] Leader response for msg:', userMsg.id, 'has pending files:', !!pendingFiles,
        pendingFiles ? `images: ${pendingFiles.images.length}, text: ${pendingFiles.extractedText.length} chars` : '');
      if (pendingFiles) {
        pendingFilesRef.current.delete(userMsg.id);
      }

      // If there's extracted text from PDFs, append it to the document context
      let fullDocumentContent = documentContent;
      if (pendingFiles?.extractedText) {
        fullDocumentContent += '\n\n## Attached File Content' + pendingFiles.extractedText;
      }

      // Read current settings from refs (not closure) since observer is set up once
      const currentApiKey = userApiKeyRef.current;
      const currentProvider = apiProviderRef.current;
      const currentModel = selectedModelRef.current;
      logger.log('[Chat] Using model:', currentModel, 'provider:', currentProvider, 'hasKey:', !!currentApiKey);

      const body: any = {
        messages: contextMessages,
        documentContent: fullDocumentContent,
        userApiKey: currentApiKey || undefined,
        provider: currentProvider,
        model: currentModel,
        roomId: roomId,
        ragEnabled: true,
      };

      // Include resized images if any
      if (pendingFiles?.images && pendingFiles.images.length > 0) {
        body.imageAttachments = pendingFiles.images;
        const totalB64 = pendingFiles.images.reduce((sum: number, img: ImageAttachment) => sum + img.base64.length, 0);
        logger.log('[Chat] Sending', pendingFiles.images.length, 'images to API, total base64 size:', totalB64);

        // Supabase edge functions have ~2MB body limit. If body would be too large, drop images.
        const bodySize = JSON.stringify(body).length;
        logger.log('[Chat] Total request body size:', bodySize);
        if (bodySize > 1_800_000) {
          logger.warn('[Chat] Body too large, sending without images');
          delete body.imageAttachments;
          // Add note about the dropped images
          const lastMsg = body.messages[body.messages.length - 1];
          if (lastMsg) {
            lastMsg.content += '\n\n(Images were attached but are too large to process. Please describe what you see or try a smaller image.)';
          }
        }
      }

      const { data, error: fnError } = await supabase.functions.invoke('chat', { body });

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

      // Extract real error from Supabase function response
      let errorData = null;
      let detailedMessage = '';
      try {
        const body = err.context?.body;
        if (body && typeof body === 'string') {
          errorData = JSON.parse(body);
        } else if (body && typeof body.getReader === 'function') {
          // ReadableStream — read it
          const reader = body.getReader();
          const chunks: Uint8Array[] = [];
          let done = false;
          while (!done) {
            const result = await reader.read();
            if (result.value) chunks.push(result.value);
            done = result.done;
          }
          const text = new TextDecoder().decode(chunks.length === 1 ? chunks[0] : await new Blob(chunks).arrayBuffer());
          try { errorData = JSON.parse(text); } catch { detailedMessage = text; }
        }
      } catch { /* ignore parse errors */ }

      const errorMsg = errorData?.error || detailedMessage || err.message || 'Failed to get AI response';
      logger.error('Chat API detailed error:', errorMsg);

      if (errorData?.rateLimited) {
        setRemainingMessages(0);
        setError('Usage limit reached. Add your API key for unlimited access.');
      } else {
        setError(errorMsg);
      }

      const errorMessage: ChatMessage = {
        id: `msg-${Date.now()}-error`,
        role: 'assistant',
        content: errorData?.rateLimited
          ? 'Free usage limit reached. Click the settings button to add your own API key for unlimited access!'
          : `Error: ${errorMsg}`,
        timestamp: Date.now(),
      };
      yArray.push([errorMessage]);
    } finally {
      setIsSending(false);
    }
  }, [roomId]); // Settings read from refs, not closure

  // Initialize Yjs bindings
  useEffect(() => {
    let cleanup: (() => void) | null = null;

    (async () => {
      try {
        const { provider } = await collaborationManager.connect();
        providerRef.current = provider;
        clientIdRef.current = provider.awareness.clientID;
        provider.awareness.setLocalStateField('activeThread', 'default');

        const yText = collaborationManager.getChatPrompt();
        const yArray = collaborationManager.getChatMessages();
        const yAttachmentsMeta = collaborationManager.getChatAttachmentsMeta();
        const ySendRequest = collaborationManager.getSendRequest();

        if (!yText || !yArray || !yAttachmentsMeta || !ySendRequest) {
          logger.error('Chat structures not available');
          return;
        }

        yTextRef.current = yText;
        yArrayRef.current = yArray;
        yAttachmentsMetaRef.current = yAttachmentsMeta;
        ySendRequestRef.current = ySendRequest;

        const yThreads = collaborationManager.getChatThreads();
        yThreadsRef.current = yThreads;

        // Initialize threads from Yjs
        if (yThreads) {
          const existingThreads: ChatThread[] = [{ id: 'default', name: 'Chat', createdAt: 0 }];
          yThreads.forEach((value: any, key: string) => {
            if (key !== 'default') {
              existingThreads.push({ id: key, name: value.name || key, createdAt: value.createdAt || 0 });
            }
          });
          setThreads(existingThreads);

          const threadsObserver = () => {
            const updated: ChatThread[] = [{ id: 'default', name: 'Chat', createdAt: 0 }];
            yThreads.forEach((value: any, key: string) => {
              if (key !== 'default') {
                updated.push({ id: key, name: value.name || key, createdAt: value.createdAt || 0 });
              }
            });
            setThreads(updated);
          };
          yThreads.observe(threadsObserver);
        }

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
            // Skip messages with attachments - only the sender can handle those (file data is local)
            const hasAttachments = lastMsg.content.includes('[Attached:');
            if (lastMsg.role === 'user' && !hasAttachments && !isSendingRef.current && !respondedMessagesRef.current.has(lastMsg.id)) {
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

        // Initialize shared attachments meta
        setSharedAttachmentsMeta(yAttachmentsMeta.toArray());

        // Observe shared attachments meta changes
        const attachmentsMetaObserver = () => {
          const newMeta = yAttachmentsMeta.toArray();
          setSharedAttachmentsMeta(newMeta);
          setHasRagChunks(newMeta.some(m => m.embeddingStatus === 'ready'));
        };
        yAttachmentsMeta.observe(attachmentsMetaObserver);

        // Observe send requests - if we have local files, we handle the request
        const sendRequestObserver = () => {
          const requestId = ySendRequest.get('id');
          const requestPrompt = ySendRequest.get('prompt');
          const requestedBy = ySendRequest.get('requestedBy');
          const handledBy = ySendRequest.get('handledBy');

          // Skip if no request, already handled, or we requested it ourselves
          if (!requestId || handledBy || requestedBy === clientIdRef.current) return;

          // Check if we have any local files
          if (localFilesRef.current.size > 0) {
            logger.log('[Chat] Handling send request from peer, we have local files');

            // Mark as handled by us
            ySendRequest.set('handledBy', clientIdRef.current);

            // Build the message and make the API call
            const userInfo = collaborationManager.getUserInfo();
            if (!userInfo) return;

            // Build content with attachment references
            let content = requestPrompt || '';
            const attachmentNames = Array.from(localFilesRef.current.values()).map(f => f.file.name);
            if (attachmentNames.length > 0) {
              const refs = attachmentNames.map(name => `[Attached: ${name}]`);
              content += '\n' + refs.join('\n');
            }

            const userMessage: ChatMessage = {
              id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              role: 'user',
              content,
              author: { name: userInfo.name, color: userInfo.color },
              timestamp: Date.now(),
            };

            // Prepare file data for API
            const images: ImageAttachment[] = [];
            let extractedText = '';
            localFilesRef.current.forEach((fileData) => {
              if (fileData.processed) {
                images.push(fileData.processed);
              }
              if (fileData.extractedText) {
                extractedText += fileData.extractedText;
              }
            });

            // Store file data for the API call
            pendingFilesRef.current.set(userMessage.id, { images, extractedText });

            // Clear local files and shared meta
            localFilesRef.current.clear();
            setAttachments([]);
            yAttachmentsMeta.delete(0, yAttachmentsMeta.length);

            // Clear prompt
            yText.doc?.transact(() => {
              yText.delete(0, yText.toString().length);
            });

            // Push message and trigger API call
            yArray.push([userMessage]);
            handleLeaderResponse(userMessage, yArray);

            // Clear the send request
            ySendRequest.delete('id');
            ySendRequest.delete('prompt');
            ySendRequest.delete('requestedBy');
            ySendRequest.delete('handledBy');
          }
        };
        ySendRequest.observe(sendRequestObserver);

        // Track per-thread presence from awareness
        const updateThreadPresence = () => {
          const states = provider.awareness.getStates();
          const myId = provider.awareness.clientID;
          const presenceMap: Record<string, Array<{name: string; color: string}>> = {};
          const typingMap: Record<string, string[]> = {};

          states.forEach((state: any, clientId: number) => {
            if (!state.user?.name) return;
            const threadId = state.activeThread || 'default';
            const userName = state.user.name;
            const userColor = state.user.color || '#999';

            // Skip self for presence dots (you know where you are)
            if (clientId !== myId) {
              if (!presenceMap[threadId]) presenceMap[threadId] = [];
              presenceMap[threadId].push({ name: userName, color: userColor });
            }

            // Track typing (include self for UI feedback)
            if (state.chatTyping) {
              const typingThread = state.chatTyping;
              if (clientId !== myId) {
                if (!typingMap[typingThread]) typingMap[typingThread] = [];
                typingMap[typingThread].push(userName);
              }
            }
          });

          setThreadPresence(presenceMap);
          setThreadTyping(typingMap);
        };

        updateThreadPresence();
        provider.awareness.on('change', updateThreadPresence);

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

        // Clean up attachments and pending send requests from disconnected peers
        const cleanupDisconnectedAttachments = ({ removed }: { added: number[], updated: number[], removed: number[] }) => {
          if (removed.length === 0) return;
          const removedSet = new Set(removed);
          const allMeta = yAttachmentsMeta.toArray();
          // Walk backwards so indices stay valid as we delete
          for (let i = allMeta.length - 1; i >= 0; i--) {
            if (removedSet.has(allMeta[i].ownerId)) {
              logger.log('[Chat] Removing attachment from disconnected peer:', allMeta[i].name, allMeta[i].ownerName);
              yAttachmentsMeta.delete(i, 1);
            }
          }

          // If there's a pending send request and no one with files is left to handle it,
          // clear it so the requester isn't stuck waiting
          const pendingRequestId = ySendRequest.get('id');
          if (pendingRequestId && !ySendRequest.get('handledBy')) {
            const remainingMeta = yAttachmentsMeta.toArray();
            if (remainingMeta.length === 0) {
              logger.log('[Chat] No file owners left online, clearing stale send request');
              ySendRequest.delete('id');
              ySendRequest.delete('prompt');
              ySendRequest.delete('requestedBy');
              ySendRequest.delete('handledBy');
            }
          }
        };

        // Initial leader check with small delay to let awareness sync
        setTimeout(updateLeaderStatus, 500);

        // Re-check leader and clean up on awareness changes
        provider.awareness.on('change', updateLeaderStatus);
        provider.awareness.on('change', cleanupDisconnectedAttachments);

        cleanup = () => {
          yText.unobserve(textObserver);
          yArray.unobserve(arrayObserver);
          yAttachmentsMeta.unobserve(attachmentsMetaObserver);
          ySendRequest.unobserve(sendRequestObserver);
          provider.awareness.off('change', updateThreadPresence);
          provider.awareness.off('change', updateLeaderStatus);
          provider.awareness.off('change', cleanupDisconnectedAttachments);
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

  // Switch Yjs bindings when active thread changes
  useEffect(() => {
    // Skip if Yjs not ready yet (initial setup handles default thread)
    if (!yArrayRef.current && activeThreadId === 'default') return;

    // Broadcast active thread to all peers via awareness
    (async () => {
      try {
        const { provider } = await collaborationManager.connect();
        provider.awareness.setLocalStateField('activeThread', activeThreadId);
      } catch {}
    })();

    let textObs: (() => void) | null = null;
    let arrayObs: (() => void) | null = null;

    (async () => {
      try {
        const { provider } = await collaborationManager.connect();

        // Get per-thread Yjs structures (default thread uses original keys for backward compat)
        const yText = activeThreadId === 'default'
          ? collaborationManager.getChatPrompt()
          : collaborationManager.getChatThreadPrompt(activeThreadId);
        const yArray = activeThreadId === 'default'
          ? collaborationManager.getChatMessages()
          : collaborationManager.getChatThreadMessages(activeThreadId);
        const ySendRequest = activeThreadId === 'default'
          ? collaborationManager.getSendRequest()
          : collaborationManager.getThreadSendRequest(activeThreadId);

        if (!yText || !yArray || !ySendRequest) return;

        // Update refs so handleSend/handleLeaderResponse use the right structures
        yTextRef.current = yText;
        yArrayRef.current = yArray;
        ySendRequestRef.current = ySendRequest;

        // Load current state
        setPrompt(yText.toString());
        setMessages(yArray.toArray());

        // Observe text
        textObs = () => setPrompt(yText.toString());
        yText.observe(textObs);

        // Observe messages with leader election
        arrayObs = () => {
          const newMessages = yArray.toArray();
          setMessages(newMessages);

          if (newMessages.length > 0) {
            const lastMsg = newMessages[newMessages.length - 1];
            const hasAttachments = lastMsg.content.includes('[Attached:');
            if (lastMsg.role === 'user' && !hasAttachments && !isSendingRef.current && !respondedMessagesRef.current.has(lastMsg.id)) {
              const states = provider.awareness.getStates();
              const clientIds = Array.from(states.keys());
              const myId = provider.awareness.clientID;
              if (!clientIds.includes(myId)) clientIds.push(myId);
              const leader = Math.min(...clientIds);
              if (myId === leader) {
                setTimeout(() => handleLeaderResponse(lastMsg, yArray), 100);
              }
            }
          }
        };
        yArray.observe(arrayObs);
      } catch (err) {
        logger.error('Failed to switch thread:', err);
      }
    })();

    return () => {
      // Clean up previous thread observers
      if (textObs && yTextRef.current) {
        try { yTextRef.current.unobserve(textObs); } catch {}
      }
      if (arrayObs && yArrayRef.current) {
        try { yArrayRef.current.unobserve(arrayObs); } catch {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId]);

  // Handle prompt input change
  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;

    if (yTextRef.current) {
      // Calculate the diff and apply to Y.Text
      const yText = yTextRef.current;
      const oldValue = yText.toString();

      // Simple diff: delete all, insert new
      yText.doc?.transact(() => {
        yText.delete(0, oldValue.length);
        yText.insert(0, newValue);
      });

      // Broadcast typing status
      if (providerRef.current) {
        providerRef.current.awareness.setLocalStateField('chatTyping', activeThreadId);
        // Clear typing after 2 seconds of no typing
        if ((window as any).__typingTimeout) clearTimeout((window as any).__typingTimeout);
        (window as any).__typingTimeout = setTimeout(() => {
          if (providerRef.current) {
            providerRef.current.awareness.setLocalStateField('chatTyping', null);
          }
        }, 2000);
      }
    }
  };

  // Populate prompt from suggestion click
  const handleSuggestionClick = (text: string) => {
    if (yTextRef.current) {
      const yText = yTextRef.current;
      const oldValue = yText.toString();
      yText.doc?.transact(() => {
        yText.delete(0, oldValue.length);
        yText.insert(0, text);
      });
    }
    textareaRef.current?.focus();
  };

  // File attachment helpers
  const addFiles = useCallback(async (files: FileList | File[]) => {
    const validFiles: AttachedFile[] = [];
    const rejected: string[] = [];
    const userInfo = collaborationManager.getUserInfo();
    const yAttachmentsMeta = yAttachmentsMetaRef.current;

    for (const file of Array.from(files)) {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        rejected.push(`${file.name}: unsupported format`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        rejected.push(`${file.name}: too large (max 5MB)`);
        continue;
      }

      const fileId = `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const isImage = file.type.startsWith('image/');

      // Add to local UI state
      validFiles.push({
        file,
        previewUrl: isImage ? URL.createObjectURL(file) : null,
      });

      // Process and store locally
      let processed: ImageAttachment | null = null;
      let extractedText = '';

      try {
        if (file.type === 'application/pdf') {
          extractedText = await extractPdfText(file);
          if (extractedText.trim()) {
            extractedText = `\n\n--- Content from ${file.name} ---\n${extractedText}`;
          }
        } else if (isImage) {
          const { base64, mimeType } = await processImageForApi(file);
          processed = { base64, mimeType, name: file.name };
        }
      } catch (err) {
        logger.warn(`Failed to process ${file.name}:`, err);
        extractedText = `\n\n--- Could not read ${file.name} ---`;
      }

      localFilesRef.current.set(fileId, { file, processed, extractedText });

      // Add metadata to shared Y.Array so other peers see it
      if (yAttachmentsMeta && userInfo) {
        const meta: SharedAttachmentMeta = {
          id: fileId,
          name: file.name,
          mimeType: file.type,
          ownerId: clientIdRef.current,
          ownerName: userInfo.name,
        };
        yAttachmentsMeta.push([meta]);

        // Trigger embedding for text-based files
        if (extractedText.trim()) {
          // Update embedding status to processing
          const metaArr = yAttachmentsMeta.toArray();
          const metaIdx = metaArr.findIndex(m => m.id === fileId);
          if (metaIdx !== -1) {
            yAttachmentsMeta.delete(metaIdx, 1);
            yAttachmentsMeta.insert(metaIdx, [{ ...meta, embeddingStatus: 'processing' as const }]);
          }

          // Call embed function (non-blocking)
          supabase.functions.invoke('embed', {
            body: { room_id: roomId, file_name: file.name, text_content: extractedText, file_id: fileId },
          }).then(({ error: embedError }) => {
            const metaArr2 = yAttachmentsMeta.toArray();
            const metaIdx2 = metaArr2.findIndex(m => m.id === fileId);
            if (metaIdx2 !== -1) {
              const newStatus = embedError ? 'error' : 'ready';
              yAttachmentsMeta.delete(metaIdx2, 1);
              yAttachmentsMeta.insert(metaIdx2, [{ ...metaArr2[metaIdx2], embeddingStatus: newStatus as any }]);
              if (!embedError) setHasRagChunks(true);
            }
          }).catch(() => {
            // Non-blocking: embedding failure doesn't block chat
          });
        }
      }
    }

    if (rejected.length > 0) {
      setError(rejected.join(', '));
      setTimeout(() => setError(null), 4000);
    }
    if (validFiles.length > 0) {
      setAttachments(prev => [...prev, ...validFiles]);
    }
  }, []);

  const removeAttachment = useCallback((index: number) => {
    const yAttachmentsMeta = yAttachmentsMetaRef.current;

    setAttachments(prev => {
      const removed = prev[index];
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);

      // Find and remove from localFilesRef and shared meta
      if (removed && yAttachmentsMeta) {
        const metaArray = yAttachmentsMeta.toArray();
        const metaIndex = metaArray.findIndex(m => m.name === removed.file.name && m.ownerId === clientIdRef.current);
        if (metaIndex !== -1) {
          const meta = metaArray[metaIndex];
          localFilesRef.current.delete(meta.id);
          yAttachmentsMeta.delete(metaIndex, 1);
        }
      }

      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const clearAttachments = useCallback(() => {
    const yAttachmentsMeta = yAttachmentsMetaRef.current;

    setAttachments(prev => {
      prev.forEach(a => { if (a.previewUrl) URL.revokeObjectURL(a.previewUrl); });
      return [];
    });

    // Clear local files
    localFilesRef.current.clear();

    // Clear our entries from shared meta
    if (yAttachmentsMeta) {
      const metaArray = yAttachmentsMeta.toArray();
      // Delete in reverse order to maintain indices
      for (let i = metaArray.length - 1; i >= 0; i--) {
        if (metaArray[i].ownerId === clientIdRef.current) {
          yAttachmentsMeta.delete(i, 1);
        }
      }
    }
  }, []);

  // Handle send message
  const handleSend = async () => {
    if (!prompt.trim() || isSending) return;

    const yText = yTextRef.current;
    const yArray = yArrayRef.current;
    const ySendRequest = ySendRequestRef.current;
    const yAttachmentsMeta = yAttachmentsMetaRef.current;
    const userInfo = collaborationManager.getUserInfo();

    if (!yText || !yArray || !ySendRequest || !yAttachmentsMeta || !userInfo) return;

    // Check who has attachments
    const allMeta = yAttachmentsMeta.toArray();
    const otherPeersAttachments = allMeta.filter(m => m.ownerId !== clientIdRef.current);
    const myAttachments = allMeta.filter(m => m.ownerId === clientIdRef.current);

    // If another peer has attachments, signal them to send
    if (otherPeersAttachments.length > 0) {
      logger.log('[Chat] Other peer has files, sending request for them to handle');
      ySendRequest.set('id', `req-${Date.now()}`);
      ySendRequest.set('prompt', prompt.trim());
      ySendRequest.set('requestedBy', clientIdRef.current);
      ySendRequest.delete('handledBy');
      return; // The peer with files will handle it
    }

    // We handle it ourselves (we have the files, or there are no files)
    let content = prompt.trim();
    if (myAttachments.length > 0) {
      const refs = myAttachments.map(m => {
        const cat = m.mimeType.startsWith('image/') ? 'image' : m.mimeType === 'application/pdf' ? 'pdf' : 'file';
        return `[Attached: ${m.name} (${cat})]`;
      });
      content += '\n' + refs.join('\n');
    }

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: 'user',
      content,
      author: { name: userInfo.name, color: userInfo.color },
      timestamp: Date.now(),
    };

    // Gather our local file data
    if (localFilesRef.current.size > 0) {
      const images: ImageAttachment[] = [];
      let extractedText = '';

      localFilesRef.current.forEach((fileData) => {
        if (fileData.processed) {
          images.push(fileData.processed);
        }
        if (fileData.extractedText) {
          extractedText += fileData.extractedText;
        }
      });

      pendingFilesRef.current.set(userMessage.id, { images, extractedText });
    }

    // Track if we have attachments before clearing
    const hasLocalFiles = localFilesRef.current.size > 0;

    // Clear prompt, local files, and shared meta
    yText.doc?.transact(() => {
      yText.delete(0, yText.toString().length);
    });
    localFilesRef.current.clear();
    setAttachments([]);
    yAttachmentsMeta.delete(0, yAttachmentsMeta.length);

    // Push message
    yArray.push([userMessage]);

    // If this message has attachments, we handle the API call ourselves
    if (hasLocalFiles) {
      handleLeaderResponse(userMessage, yArray);
    }
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

  // Drag-and-drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
    }
    // Reset so the same file can be re-selected
    e.target.value = '';
  };

  return (
    <div
      className={`chat-sidebar ${isAnimating ? 'animating' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="chat-drop-overlay">
          <div className="chat-drop-overlay-content">
            <Upload size={24} />
            <span>Drop files here</span>
          </div>
        </div>
      )}

      <div className="chat-header">
        <div className="chat-title-row">
          <h3>AI Chat</h3>
          <span className="chat-status">
            {isSending
              ? 'Thinking...'
              : !userApiKey
                ? 'Limited usage'
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

      {/* Thread Tabs */}
      <div className="chat-thread-tabs">
        {threads.map((thread) => (
          <div
            key={thread.id}
            className={`chat-thread-tab ${thread.id === activeThreadId ? 'active' : ''}`}
            onClick={() => setActiveThreadId(thread.id)}
          >
            <MessageSquare size={12} />
            <span>{thread.name}</span>
            {threadPresence[thread.id] && threadPresence[thread.id].length > 0 && (
              <span className="chat-thread-presence">
                {threadPresence[thread.id].slice(0, 3).map((peer, i) => (
                  <span
                    key={i}
                    className="chat-thread-presence-dot"
                    style={{ backgroundColor: peer.color }}
                    title={peer.name}
                  />
                ))}
                {threadPresence[thread.id].length > 3 && (
                  <span className="chat-thread-presence-more">+{threadPresence[thread.id].length - 3}</span>
                )}
              </span>
            )}
            {threadTyping[thread.id] && threadTyping[thread.id].length > 0 && (
              <span className="chat-thread-typing" title={`${threadTyping[thread.id].join(', ')} typing...`}>
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </span>
            )}
            {thread.id !== 'default' && (
              <button
                className="chat-thread-close"
                onClick={(e) => {
                  e.stopPropagation();
                  // Remove thread
                  setThreads(prev => prev.filter(t => t.id !== thread.id));
                  if (activeThreadId === thread.id) setActiveThreadId('default');
                  if (yThreadsRef.current) yThreadsRef.current.delete(thread.id);
                }}
              >
                <X size={10} />
              </button>
            )}
          </div>
        ))}
        <button
          className="chat-thread-add"
          onClick={() => {
            const newId = `thread-${Date.now()}`;
            const newThread: ChatThread = {
              id: newId,
              name: `Chat ${threads.length + 1}`,
              createdAt: Date.now(),
            };
            setThreads(prev => [...prev, newThread]);
            setActiveThreadId(newId);

            // Sync to Yjs
            if (yThreadsRef.current) {
              yThreadsRef.current.set(newId, { name: newThread.name, createdAt: newThread.createdAt });
            }
          }}
          title="New chat thread"
        >
          <Plus size={14} />
        </button>
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
                  setSelectedModel('gpt-4o-mini');
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
                : 'Add your key for unlimited access & more models'}
            </span>
          </div>

          {userApiKey && (
            <button
              className="chat-clear-key-btn"
              onClick={() => {
                setUserApiKey('');
                setSelectedModel('gpt-4o-mini');
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
            <div className="chat-welcome-logo">
              <Logo size={36} strokeColor="white" />
            </div>
            <h2>How can I help you today?</h2>
            <div className="chat-suggestions">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.label}
                  className="chat-suggestion-btn"
                  onClick={() => handleSuggestionClick(s.label)}
                >
                  <s.icon size={16} />
                  {s.label}
                </button>
              ))}
            </div>
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
              <div className="chat-message-content"><MessageContent content={msg.content} /></div>
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
              {threadTyping[activeThreadId] && threadTyping[activeThreadId].length > 0 && (
                <div className="chat-typing-indicator">
                  <span className="chat-typing-dots">
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                  </span>
                  <span className="chat-typing-text">
                    {threadTyping[activeThreadId].join(', ')} {threadTyping[activeThreadId].length === 1 ? 'is' : 'are'} typing...
                  </span>
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
        <div className="chat-input-card">
          {sharedAttachmentsMeta.length > 0 && (
            <div className="chat-attachments">
              {sharedAttachmentsMeta.map((meta) => {
                const isOwn = meta.ownerId === clientIdRef.current;
                const localFile = attachments.find(a => a.file.name === meta.name);
                const cat = meta.mimeType.startsWith('image/') ? 'image' : meta.mimeType === 'application/pdf' ? 'pdf' : 'file';
                return (
                  <div key={meta.id} className={`chat-attachment-chip ${!isOwn ? 'from-peer' : ''}`}>
                    {cat === 'image' && localFile?.previewUrl ? (
                      <img src={localFile.previewUrl} alt={meta.name} />
                    ) : (
                      <span className={`chat-attachment-chip-icon ${cat}`}>
                        <FileText size={14} />
                      </span>
                    )}
                    <span className="chat-attachment-chip-name">
                      {meta.name}
                      {!isOwn && <span className="chat-attachment-owner"> ({meta.ownerName})</span>}
                    </span>
                    {meta.embeddingStatus && (
                      <span className={`chat-embedding-status ${meta.embeddingStatus}`}>
                        {meta.embeddingStatus === 'processing' && <Loader2 size={10} className="spinning" />}
                        {meta.embeddingStatus === 'ready' && <Sparkles size={10} />}
                        {meta.embeddingStatus === 'error' && <X size={10} />}
                      </span>
                    )}
                    {isOwn && (
                      <button
                        className="chat-attachment-chip-remove"
                        onClick={() => {
                          const idx = attachments.findIndex(a => a.file.name === meta.name);
                          if (idx !== -1) removeAttachment(idx);
                        }}
                      >
                        <X size={10} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <textarea
            ref={textareaRef}
            className="chat-input"
            placeholder="Ask anything..."
            value={prompt}
            onChange={handlePromptChange}
            onKeyDown={handleKeyDown}
            disabled={isSending}
            rows={2}
          />
          <div className="chat-input-actions">
            <div className="chat-input-left">
              <button
                className="chat-attach-button"
                onClick={() => fileInputRef.current?.click()}
                title="Attach files"
              >
                <Paperclip size={16} />
                {sharedAttachmentsMeta.length > 0 && (
                  <span className="chat-attach-badge">{sharedAttachmentsMeta.length}</span>
                )}
              </button>
              <div className="chat-model-picker">
                <select
                  className="chat-model-picker-select"
                  value={selectedModel}
                  onChange={(e) => {
                    const newModel = e.target.value;
                    setSelectedModel(newModel);
                    const modelInfo = getAvailableModels().find(m => m.id === newModel);
                    if (modelInfo) {
                      setApiProvider(modelInfo.provider as 'openai' | 'anthropic');
                    }
                  }}
                >
                  {getAvailableModels().map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={12} className="chat-model-picker-chevron" />
              </div>
            </div>
            <button
              className="chat-send-button"
              onClick={handleSend}
              disabled={!prompt.trim() || isSending}
              title="Send message"
            >
              {isSending ? <Loader2 size={16} className="spinning" /> : <Send size={16} />}
            </button>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,.ppt,.pptx"
          style={{ display: 'none' }}
          onChange={handleFileInputChange}
        />
      </div>
    </div>
  );
}
