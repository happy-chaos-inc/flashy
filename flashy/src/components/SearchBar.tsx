import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, X, FileText, Copy, Check } from 'lucide-react';
import { supabase } from '../config/supabase';
import './SearchBar.css';

interface SearchResult {
  file_name: string;
  chunk_index: number;
  text_content: string;
  rrf_score: number;
}

interface SearchBarProps {
  roomId: string;
}

export function SearchBar({ roomId }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [hasChunks, setHasChunks] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

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
      setIsOpen(false);
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
      setIsOpen(true);
      setSelectedIndex(-1);
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

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 300);
  };

  const handleCopyResult = async (result: SearchResult, index: number) => {
    try {
      await navigator.clipboard.writeText(result.text_content);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1500);
    } catch {
      // Fallback
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
    if (!isOpen || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault();
      handleCopyResult(results[selectedIndex], selectedIndex);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      inputRef.current?.blur();
    }
  };

  const clearSearch = () => {
    setQuery('');
    setResults([]);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const truncateText = (text: string, maxLen = 120) => {
    if (text.length <= maxLen) return text;
    return text.substring(0, maxLen) + '...';
  };

  return (
    <div className="search-bar-container">
      <div className="search-bar-input-wrapper">
        <Search size={16} className="search-bar-icon" />
        <input
          ref={inputRef}
          type="text"
          className="search-bar-input"
          placeholder="Search files... (⌘K)"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (results.length > 0) setIsOpen(true); }}
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
          {results.length === 0 ? (
            <div className="search-bar-empty">
              {isSearching ? 'Searching...' : hasChunks === false ? 'Upload files to enable search' : 'No results found'}
            </div>
          ) : (
            results.map((result, i) => (
              <div
                key={`${result.file_name}-${result.chunk_index}`}
                className={`search-bar-result ${i === selectedIndex ? 'selected' : ''}`}
                onClick={() => handleCopyResult(result, i)}
                onMouseEnter={() => setSelectedIndex(i)}
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
            ))
          )}
        </div>
      )}
    </div>
  );
}
