import React from 'react';
import { k as SearchResult } from './types-CLttS8-d.js';

interface UsePineconeSearchOptions {
    search: string;
    endpoint?: string;
    initialQuery?: string;
    debounceMs?: number;
    topK?: number;
    rerankTopN?: number;
    autoSearch?: boolean;
}
interface UsePineconeSearchState {
    query: string;
    setQuery: React.Dispatch<React.SetStateAction<string>>;
    results: SearchResult[];
    isLoading: boolean;
    error?: string;
    runSearch: (queryOverride?: string) => Promise<void>;
    clear: () => void;
}
declare function usePineconeSearch(options: UsePineconeSearchOptions): UsePineconeSearchState;
interface PineconeSearchInputProps extends UsePineconeSearchOptions {
    className?: string;
    placeholder?: string;
    submitLabel?: string;
    renderResult?: (result: SearchResult) => React.ReactNode;
}
declare function PineconeSearchInput(props: PineconeSearchInputProps): React.ReactElement;

export { PineconeSearchInput, usePineconeSearch };
