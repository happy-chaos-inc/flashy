import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, X, FileText, Copy, Check, AlignLeft } from 'lucide-react';
import { supabase } from '../config/supabase';
import { collaborationManager } from '../lib/CollaborationManager';
import { prosemirrorToMarkdown } from '../lib/prosemirrorToMarkdown';
import './SearchBar.css';

interface SearchResult {
  file_name: string;
  chunk_index: number;
  text_content: string;
  rrf_score: number;
}

interface DocMatch {
  snippet: string;
  matchIndex: number; // Nth occurrence in the document
}

interface SearchBarProps {
  roomId: string;
}

export function SearchBar({ roomId }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [docMatches, setDocMatches] = useState<DocMatch[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [hasChunks, setHasChunks] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Total items for keyboard navigation
  const totalItems = docMatches.length + results.length;

  // Search the current document locally (instant, no debounce)
  const searchDocument = useCallback((searchQuery: string) => {
    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      setDocMatches([]);
      return;
    }

    try {
      const ydoc = collaborationManager.getYDoc();
      if (!ydoc) { setDocMatches([]); return; }

      const fragment = ydoc.getXmlFragment('prosemirror');
      const docText = prosemirrorToMarkdown(fragment);
      if (!docText) { setDocMatches([]); return; }

      const needle = searchQuery.trim().toLowerCase();
      const matches: DocMatch[] = [];
      let searchFrom = 0;
      let matchIdx = 0;

      while (searchFrom < docText.length && matches.length < 10) {
        const pos = docText.toLowerCase().indexOf(needle, searchFrom);
        if (pos === -1) break;

        // Build a snippet with surrounding context
        const snippetStart = Math.max(0, pos - 40);
        const snippetEnd = Math.min(docText.length, pos + needle.length + 60);
        let snippet = docText.substring(snippetStart, snippetEnd).replace(/\n/g, ' ');
        if (snippetStart > 0) snippet = '...' + snippet;
        if (snippetEnd < docText.length) snippet = snippet + '...';

        matches.push({ snippet, matchIndex: matchIdx });
        matchIdx++;
        searchFrom = pos + needle.length;
      }

      setDocMatches(matches);
    } catch {
      setDocMatches([]);
    }
  }, []);

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cmd+K / Ctrl+K to focus search bar
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  const doSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke('search', {
        body: { room_id: roomId, query: searchQuery.trim() },
      });

      if (error) throw error;

      const searchResults: SearchResult[] = data?.results || [];
      setResults(searchResults);
      setHasChunks(searchResults.length > 0 || hasChunks === true);
    } catch (err) {
      console.error('Search failed:', err);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [roomId, hasChunks]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);

    // Instant local document search
    searchDocument(value);

    // Open dropdown if there's a query
    if (value.trim()) {
      setIsOpen(true);
      setSelectedIndex(-1);
    } else {
      setIsOpen(false);
    }

    // Debounced RAG search
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 300);
  };

  const handleDocMatchClick = (match: DocMatch) => {
    window.dispatchEvent(new CustomEvent('searchScrollTo', {
      detail: { query: query.trim(), matchIndex: match.matchIndex }
    }));
    setIsOpen(false);
  };

  const handleCopyResult = async (result: SearchResult, index: number) => {
    try {
      await navigator.clipboard.writeText(result.text_content);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1500);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = result.text_content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1500);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || totalItems === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, totalItems - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault();
      if (selectedIndex < docMatches.length) {
        handleDocMatchClick(docMatches[selectedIndex]);
      } else {
        const ragIdx = selectedIndex - docMatches.length;
        handleCopyResult(results[ragIdx], ragIdx);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      inputRef.current?.blur();
    }
  };

  const clearSearch = () => {
    setQuery('');
    setResults([]);
    setDocMatches([]);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const truncateText = (text: string, maxLen = 120) => {
    if (text.length <= maxLen) return text;
    return text.substring(0, maxLen) + '...';
  };

  // Render snippet with highlighted query
  const highlightSnippet = (snippet: string) => {
    const needle = query.trim();
    if (!needle) return snippet;
    const regex = new RegExp(`(${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = snippet.split(regex);
    return parts.map((part, i) =>
      regex.test(part)
        ? <mark key={i} className="search-bar-highlight">{part}</mark>
        : part
    );
  };

  const hasAnyResults = docMatches.length > 0 || results.length > 0;

  return (
    <div className="search-bar-container">
      <div className="search-bar-input-wrapper">
        <Search size={16} className="search-bar-icon" />
        <input
          ref={inputRef}
          type="text"
          className="search-bar-input"
          placeholder="Search doc & files... (⌘K)"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (hasAnyResults) setIsOpen(true); }}
        />
        {query && (
          <button className="search-bar-clear" onClick={clearSearch}>
            <X size={14} />
          </button>
        )}
        {isSearching && <div className="search-bar-spinner" />}
      </div>

      {isOpen && (
        <div ref={dropdownRef} className="search-bar-dropdown">
          {!hasAnyResults && !isSearching ? (
            <div className="search-bar-empty">
              {query.trim().length < 2 ? 'Type at least 2 characters' : 'No results found'}
            </div>
          ) : (
            <>
              {docMatches.length > 0 && (
                <>
                  <div className="search-bar-section-header">
                    <AlignLeft size={12} />
                    In Document
                    <span className="search-bar-section-count">{docMatches.length}</span>
                  </div>
                  {docMatches.map((match, i) => (
                    <div
                      key={`doc-${match.matchIndex}`}
                      className={`search-bar-result ${i === selectedIndex ? 'selected' : ''}`}
                      onClick={() => handleDocMatchClick(match)}
                      onMouseEnter={() => setSelectedIndex(i)}
                    >
                      <div className="search-bar-result-text">
                        {highlightSnippet(match.snippet)}
                      </div>
                    </div>
                  ))}
                </>
              )}
              {results.length > 0 && (
                <>
                  <div className="search-bar-section-header">
                    <FileText size={12} />
                    From Files
                    <span className="search-bar-section-count">{results.length}</span>
                  </div>
                  {results.map((result, i) => {
                    const flatIndex = docMatches.length + i;
                    return (
                      <div
                        key={`${result.file_name}-${result.chunk_index}`}
                        className={`search-bar-result ${flatIndex === selectedIndex ? 'selected' : ''}`}
                        onClick={() => handleCopyResult(result, i)}
                        onMouseEnter={() => setSelectedIndex(flatIndex)}
                      >
                        <div className="search-bar-result-header">
                          <FileText size={14} className="search-bar-result-icon" />
                          <span className="search-bar-result-file">{result.file_name}</span>
                          <span className="search-bar-result-score">
                            {(result.rrf_score * 100).toFixed(0)}%
                          </span>
                          <button
                            className="search-bar-result-copy"
                            onClick={(e) => { e.stopPropagation(); handleCopyResult(result, i); }}
                          >
                            {copiedIndex === i ? <Check size={12} /> : <Copy size={12} />}
                          </button>
                        </div>
                        <div className="search-bar-result-text">
                          {truncateText(result.text_content)}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
              {isSearching && results.length === 0 && (
                <div className="search-bar-empty">Searching files...</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
