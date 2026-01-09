'use client';

import { useState, useMemo } from 'react';
import { Search, X, Filter, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface MessageSearchProps {
  messages: Message[];
  onResultClick?: (messageId: string) => void;
}

type FilterType = 'all' | 'user' | 'assistant' | 'bookmarked' | 'hasCode';

export function MessageSearch({ messages, onResultClick }: MessageSearchProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filteredMessages = useMemo(() => {
    let results = messages;

    // Apply content search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      results = results.filter(m =>
        m.content.toLowerCase().includes(query)
      );
    }

    // Apply type filter
    if (filterType !== 'all') {
      switch (filterType) {
        case 'user':
          results = results.filter(m => m.role === 'user');
          break;
        case 'assistant':
          results = results.filter(m => m.role === 'assistant');
          break;
        case 'hasCode':
          results = results.filter(m => m.content.includes('```'));
          break;
      }
    }

    return results;
  }, [messages, searchQuery, filterType]);

  const highlightMatch = (text: string, query: string) => {
    if (!query.trim()) return text;

    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);

    return parts.map((part, i) =>
      regex.test(part) ? (
        <mark key={i} className="bg-[var(--warning)]/30 text-[var(--foreground)] rounded px-0.5">
          {part}
        </mark>
      ) : part
    );
  };

  const truncateContent = (content: string, maxLength: number = 150) => {
    if (content.length <= maxLength) return content;
    return content.slice(0, maxLength) + '...';
  };

  return (
    <div className="relative">
      {/* Search Bar */}
      <div className="flex items-center gap-2 p-3 border-b border-[var(--border)] bg-[var(--accent)]/30">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9a9590]" />
          <input
            type="text"
            placeholder="Search messages..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-8 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-[var(--accent)] transition-colors"
            >
              <X className="h-3 w-3 text-[#9a9590]" />
            </button>
          )}
        </div>

        {/* Filter Dropdown */}
        <div className="relative">
          <button
            onClick={() => setIsFilterOpen(!isFilterOpen)}
            className="flex items-center gap-1.5 px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--accent)] transition-colors"
          >
            <Filter className="h-3.5 w-3.5 text-[#9a9590]" />
            <span className="capitalize hidden sm:inline">{filterType}</span>
            <ChevronDown className={`h-3 w-3.5 text-[#9a9590] transition-transform ${isFilterOpen ? 'rotate-180' : ''}`} />
          </button>

          <AnimatePresence>
            {isFilterOpen && (
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 top-full mt-2 w-40 bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-lg z-50 overflow-hidden"
              >
                {(['all', 'user', 'assistant', 'hasCode'] as FilterType[]).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => {
                      setFilterType(filter);
                      setIsFilterOpen(false);
                    }}
                    className={`w-full px-3 py-2 text-left text-sm hover:bg-[var(--accent)] transition-colors ${
                      filterType === filter ? 'bg-[var(--accent)] text-[var(--primary)]' : 'text-[var(--foreground)]'
                    }`}
                  >
                    {filter === 'hasCode' ? 'Has Code' : filter.charAt(0).toUpperCase() + filter.slice(1)}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Results */}
      <div className="max-h-[60vh] overflow-y-auto">
        <AnimatePresence mode="wait">
          {searchQuery && filteredMessages.length === 0 ? (
            <motion.div
              key="no-results"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="p-8 text-center text-[#9a9590]"
            >
              <Search className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No messages found</p>
              <p className="text-xs mt-1">Try adjusting your search or filters</p>
            </motion.div>
          ) : searchQuery ? (
            <motion.div
              key="results"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="p-2 space-y-1"
            >
              <div className="px-2 py-1 text-xs text-[#9a9590] font-medium">
                {filteredMessages.length} {filteredMessages.length === 1 ? 'result' : 'results'}
              </div>
              {filteredMessages.map((message, index) => (
                <motion.button
                  key={message.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.03 }}
                  onClick={() => onResultClick?.(message.id)}
                  className="w-full p-3 rounded-lg hover:bg-[var(--accent)] transition-colors text-left group"
                >
                  <div className="flex items-start gap-2">
                    <div className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium ${
                      message.role === 'user'
                        ? 'bg-[var(--primary)] text-white'
                        : 'bg-[var(--success)] text-white'
                    }`}>
                      {message.role === 'user' ? 'U' : 'A'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-[#b0a8a0] mb-1 line-clamp-2">
                        {highlightMatch(truncateContent(message.content), searchQuery)}
                      </p>
                      {message.content.includes('```') && (
                        <span className="inline-flex items-center gap-1 text-xs text-[var(--success)]">
                          <code>&lt;/&gt;</code>
                          <span>has code</span>
                        </span>
                      )}
                    </div>
                  </div>
                </motion.button>
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="p-8 text-center text-[#9a9590]"
            >
              <Search className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm font-medium">Search Messages</p>
              <p className="text-xs mt-1">Type to search through conversation</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
