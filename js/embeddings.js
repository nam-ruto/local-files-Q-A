// js/embeddings.js - Simple TF-IDF based approach (no transformers.js)
class EmbeddingGenerator {
    constructor() {
        this.isInitialized = false;
        this.vocabulary = new Map();
        this.idfScores = new Map();
        this.vectorSize = 384; // Standard embedding dimension
    }

    async initialize(progressCallback) {
        if (this.isInitialized) return;

        try {
            progressCallback?.(10, 'Initializing text processing...');
            
            // Simple initialization - no external dependencies
            this.vocabulary.clear();
            this.idfScores.clear();
            
            progressCallback?.(50, 'Setting up text analysis...');
            
            // Simulate some loading time for user feedback
            await new Promise(resolve => setTimeout(resolve, 500));
            
            this.isInitialized = true;
            progressCallback?.(100, 'Text processing ready!');
            
            console.log('✅ TF-IDF embedding system initialized');

        } catch (error) {
            console.error('Error initializing embedding system:', error);
            throw new Error('Failed to initialize text processing system.');
        }
    }

    async generateEmbedding(text) {
        if (!this.isInitialized) {
            throw new Error('Embedding system not initialized');
        }

        return this.generateTFIDFVector(text);
    }

    generateTFIDFVector(text) {
        const words = this.tokenize(text);
        const termFreq = this.calculateTermFrequency(words);
        
        // Create a fixed-size vector
        const vector = new Float32Array(this.vectorSize);
        
        // Use a simple hash function to map words to vector positions
        termFreq.forEach((tf, word) => {
            const positions = this.getWordPositions(word, 3); // Use 3 positions per word
            const idf = this.idfScores.get(word) || 1;
            const score = tf * idf;
            
            positions.forEach(pos => {
                vector[pos] += score;
            });
        });
        
        // Normalize the vector
        return this.normalizeVector(vector);
    }

    getWordPositions(word, count = 3) {
        // Simple hash function to get consistent positions for each word
        const positions = [];
        let hash = 0;
        
        for (let i = 0; i < word.length; i++) {
            hash = ((hash << 5) - hash + word.charCodeAt(i)) & 0xffffffff;
        }
        
        for (let i = 0; i < count; i++) {
            const pos = Math.abs(hash + i * 123456789) % this.vectorSize;
            positions.push(pos);
        }
        
        return positions;
    }

    tokenize(text) {
        return text.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length > 2 && word.length < 20) // Filter reasonable word lengths
            .slice(0, 100); // Limit to first 100 words for performance
    }

    calculateTermFrequency(words) {
        const termFreq = new Map();
        const totalWords = words.length;
        
        if (totalWords === 0) return termFreq;
        
        words.forEach(word => {
            termFreq.set(word, (termFreq.get(word) || 0) + 1);
        });
        
        // Normalize by document length
        termFreq.forEach((count, word) => {
            termFreq.set(word, count / totalWords);
        });
        
        return termFreq;
    }

    normalizeVector(vector) {
        const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
        if (magnitude === 0) return vector;
        
        const normalized = new Float32Array(vector.length);
        for (let i = 0; i < vector.length; i++) {
            normalized[i] = vector[i] / magnitude;
        }
        return normalized;
    }

    async generateEmbeddingsBatch(chunks, progressCallback) {
        // First pass: build vocabulary from all chunks
        progressCallback?.(65, 'Analyzing document vocabulary...');
        this.buildVocabulary(chunks);
        
        // Second pass: generate embeddings
        const embeddings = [];
        const total = chunks.length;

        for (let i = 0; i < total; i++) {
            try {
                const embedding = await this.generateEmbedding(chunks[i].text);
                embeddings.push(embedding);
                
                const progress = 70 + ((i + 1) / total) * 25; // 70-95%
                progressCallback?.(progress, `Generating text vectors: ${i + 1}/${total}`);
                
                // Small delay to prevent UI blocking
                if (i % 10 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 1));
                }
                
            } catch (error) {
                console.error(`Error generating embedding for chunk ${i}:`, error);
                embeddings.push(new Float32Array(this.vectorSize));
            }
        }

        progressCallback?.(95, 'Finalizing embeddings...');
        return embeddings;
    }

    buildVocabulary(chunks) {
        const documentFreq = new Map();
        const totalDocs = chunks.length;
        
        // Count document frequency for each word
        chunks.forEach(chunk => {
            const words = new Set(this.tokenize(chunk.text));
            words.forEach(word => {
                documentFreq.set(word, (documentFreq.get(word) || 0) + 1);
            });
        });
        
        // Calculate IDF scores
        documentFreq.forEach((freq, word) => {
            const idf = Math.log(totalDocs / (freq + 1)) + 1; // Add smoothing
            this.idfScores.set(word, idf);
        });
        
        console.log(`📚 Built vocabulary with ${this.idfScores.size} unique terms`);
    }

    // Enhanced cosine similarity with better handling
    static cosineSimilarity(a, b) {
        if (a.length !== b.length) {
            console.warn('Vector length mismatch, truncating to shorter length');
            const minLength = Math.min(a.length, b.length);
            a = a.slice(0, minLength);
            b = b.slice(0, minLength);
        }

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            const valA = a[i] || 0;
            const valB = b[i] || 0;
            
            dotProduct += valA * valB;
            normA += valA * valA;
            normB += valB * valB;
        }

        if (normA === 0 || normB === 0) {
            return 0;
        }

        const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
        
        // Ensure similarity is between 0 and 1
        return Math.max(0, Math.min(1, similarity));
    }

    // Add keyword-based similarity as backup
    static keywordSimilarity(textA, textB) {
        const wordsA = new Set(textA.toLowerCase().split(/\s+/).filter(w => w.length > 2));
        const wordsB = new Set(textB.toLowerCase().split(/\s+/).filter(w => w.length > 2));
        
        const intersection = new Set([...wordsA].filter(word => wordsB.has(word)));
        const union = new Set([...wordsA, ...wordsB]);
        
        return union.size > 0 ? intersection.size / union.size : 0;
    }

    getStatus() {
        return {
            initialized: this.isInitialized,
            method: 'TF-IDF Text Similarity',
            vocabularySize: this.idfScores.size,
            vectorSize: this.vectorSize
        };
    }
}

// Export the embedding generator instance
export const embeddingGenerator = new EmbeddingGenerator();
window.embeddingGenerator = embeddingGenerator;