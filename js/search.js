// js/search.js
import { documentDB } from './database.js';
import { embeddingGenerator } from './embeddings.js';

class VectorSearch {
    constructor() {
        this.defaultTopK = 5;
        this.similarityThreshold = 0.3; // Minimum similarity score
    }

    async searchSimilarChunks(queryText, documentId = null, topK = this.defaultTopK) {
        try {
            // Step 1: Generate embedding for the query
            if (!embeddingGenerator.isInitialized) {
                throw new Error('Embedding model not initialized. Please wait for model to load.');
            }

            const queryEmbedding = await embeddingGenerator.generateEmbedding(queryText);

            // Step 2: Get chunks to search
            let chunks;
            if (documentId) {
                chunks = await documentDB.getDocumentChunks(documentId);
            } else {
                chunks = await documentDB.getAllChunks();
            }

            if (chunks.length === 0) {
                return {
                    results: [],
                    query: queryText,
                    totalSearched: 0
                };
            }

            // Step 3: Calculate similarities
            const similarities = chunks.map(chunk => {
                try {
                    // Ensure embedding is Float32Array
                    let chunkEmbedding = chunk.embedding;
                    if (!(chunkEmbedding instanceof Float32Array)) {
                        chunkEmbedding = new Float32Array(chunkEmbedding);
                    }

                    const similarity = embeddingGenerator.constructor.cosineSimilarity(
                        queryEmbedding, 
                        chunkEmbedding
                    );

                    return {
                        chunk,
                        similarity,
                        documentId: chunk.documentId
                    };
                } catch (error) {
                    console.error('Error calculating similarity for chunk:', chunk.id, error);
                    return {
                        chunk,
                        similarity: 0,
                        documentId: chunk.documentId
                    };
                }
            });

            // Step 4: Filter and sort results
            const filteredResults = similarities
                .filter(result => result.similarity >= this.similarityThreshold)
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, topK);

            // Step 5: Enhance results with document info
            const enhancedResults = await Promise.all(
                filteredResults.map(async (result) => {
                    const document = await documentDB.getDocument(result.documentId);
                    return {
                        ...result,
                        documentName: document?.filename || 'Unknown Document',
                        uploadDate: document?.uploadDate
                    };
                })
            );

            return {
                results: enhancedResults,
                query: queryText,
                totalSearched: chunks.length,
                hasResults: enhancedResults.length > 0
            };

        } catch (error) {
            console.error('Error during vector search:', error);
            throw error;
        }
    }

    async searchInDocument(queryText, documentId, topK = this.defaultTopK) {
        return await this.searchSimilarChunks(queryText, documentId, topK);
    }

    async searchAllDocuments(queryText, topK = this.defaultTopK) {
        return await this.searchSimilarChunks(queryText, null, topK);
    }

    // Hybrid search: combine vector search with keyword matching
    async hybridSearch(queryText, documentId = null, topK = this.defaultTopK) {
        try {
            // Get vector search results
            const vectorResults = await this.searchSimilarChunks(queryText, documentId, topK * 2);
            
            // Simple keyword matching for fallback
            const keywords = queryText.toLowerCase().split(/\s+/).filter(word => word.length > 2);
            
            const enhancedResults = vectorResults.results.map(result => {
                // Calculate keyword match score
                const text = result.chunk.text.toLowerCase();
                let keywordScore = 0;
                
                keywords.forEach(keyword => {
                    const matches = (text.match(new RegExp(keyword, 'g')) || []).length;
                    keywordScore += matches * 0.1; // Weight keyword matches
                });
                
                // Combine vector similarity with keyword score
                const combinedScore = result.similarity + keywordScore;
                
                return {
                    ...result,
                    keywordScore,
                    combinedScore
                };
            });

            // Re-sort by combined score
            enhancedResults.sort((a, b) => b.combinedScore - a.combinedScore);
            
            return {
                results: enhancedResults.slice(0, topK),
                query: queryText,
                totalSearched: vectorResults.totalSearched,
                hasResults: enhancedResults.length > 0,
                searchType: 'hybrid'
            };

        } catch (error) {
            console.error('Error during hybrid search:', error);
            throw error;
        }
    }

    // Get search suggestions based on chunk content
    async getSearchSuggestions(documentId = null, limit = 5) {
        try {
            let chunks;
            if (documentId) {
                chunks = await documentDB.getDocumentChunks(documentId);
            } else {
                chunks = await documentDB.getAllChunks();
            }

            if (chunks.length === 0) {
                return [];
            }

            // Extract potential search terms from chunks
            const suggestions = [];
            const usedTerms = new Set();

            chunks.forEach(chunk => {
                // Simple extraction of potential question topics
                const sentences = chunk.text.split(/[.!?]+/).filter(s => s.trim().length > 10);
                
                sentences.slice(0, 2).forEach(sentence => {
                    // Look for noun phrases or key terms
                    const words = sentence.trim().split(/\s+/);
                    if (words.length >= 3 && words.length <= 8) {
                        const suggestion = words.join(' ').substring(0, 60);
                        if (!usedTerms.has(suggestion.toLowerCase())) {
                            suggestions.push({
                                text: suggestion,
                                documentId: chunk.documentId
                            });
                            usedTerms.add(suggestion.toLowerCase());
                        }
                    }
                });
            });

            return suggestions.slice(0, limit);

        } catch (error) {
            console.error('Error getting search suggestions:', error);
            return [];
        }
    }

    // Format search results for display
    formatSearchResults(searchResponse) {
        if (!searchResponse.hasResults) {
            return {
                html: '<div class="empty-state"><h3>No results found</h3><p>Try different keywords or check if the document has been processed.</p></div>',
                count: 0
            };
        }

        const resultsHtml = searchResponse.results.map((result, index) => {
            const similarityPercent = Math.round(result.similarity * 100);
            const excerpt = this.highlightKeywords(result.chunk.text, searchResponse.query);
            
            return `
                <div class="result-item">
                    <div class="result-score">
                        Similarity: ${similarityPercent}% • Document: ${result.documentName} • Chunk ${result.chunk.chunkIndex + 1}
                    </div>
                    <div class="result-text">${excerpt}</div>
                </div>
            `;
        }).join('');

        return {
            html: resultsHtml,
            count: searchResponse.results.length,
            totalSearched: searchResponse.totalSearched
        };
    }

    // Helper function to highlight keywords in text
    highlightKeywords(text, query) {
        if (!query || query.length < 2) return text;
        
        const keywords = query.toLowerCase().split(/\s+/).filter(word => word.length > 2);
        let highlightedText = text;
        
        keywords.forEach(keyword => {
            const regex = new RegExp(`(${keyword})`, 'gi');
            highlightedText = highlightedText.replace(regex, '<mark>$1</mark>');
        });
        
        // Truncate if too long
        if (highlightedText.length > 400) {
            highlightedText = highlightedText.substring(0, 400) + '...';
        }
        
        return highlightedText;
    }
}

// Export the search instance
export const vectorSearch = new VectorSearch();
window.vectorSearch = vectorSearch;