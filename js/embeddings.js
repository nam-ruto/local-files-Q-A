// js/embeddings.js
class EmbeddingGenerator {
    constructor() {
        this.model = null;
        this.isInitialized = false;
        this.modelName = 'Xenova/all-MiniLM-L6-v2';
    }

    async initialize(progressCallback) {
        if (this.isInitialized) return;

        try {
            progressCallback?.(0, 'Loading embedding model...');
            
            // Dynamic import of transformers.js
            const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
            
            progressCallback?.(30, 'Initializing model...');
            
            // Create feature extraction pipeline
            this.model = await pipeline('feature-extraction', this.modelName, {
                progress_callback: (progress) => {
                    const percent = 30 + (progress.progress || 0) * 50; // 30-80%
                    progressCallback?.(percent, `Loading model: ${progress.status || 'Processing...'}`);
                }
            });

            this.isInitialized = true;
            progressCallback?.(90, 'Model ready!');

        } catch (error) {
            console.error('Error initializing embedding model:', error);
            throw new Error('Failed to load embedding model. Please check your internet connection.');
        }
    }

    async generateEmbedding(text) {
        if (!this.isInitialized) {
            throw new Error('Embedding model not initialized');
        }

        try {
            // Clean and truncate text if needed
            const cleanText = text.substring(0, 512); // Limit to ~512 tokens
            
            // Generate embedding
            const output = await this.model(cleanText, {
                pooling: 'mean',
                normalize: true
            });

            // Convert to Float32Array for efficient storage
            const embedding = new Float32Array(output.data);
            return embedding;

        } catch (error) {
            console.error('Error generating embedding:', error);
            throw new Error('Failed to generate embedding for text');
        }
    }

    async generateEmbeddingsBatch(chunks, progressCallback) {
        const embeddings = [];
        const total = chunks.length;

        for (let i = 0; i < total; i++) {
            try {
                const embedding = await this.generateEmbedding(chunks[i].text);
                embeddings.push(embedding);
                
                const progress = 60 + ((i + 1) / total) * 30; // 60-90%
                progressCallback?.(progress, `Generating embeddings: ${i + 1}/${total}`);
                
            } catch (error) {
                console.error(`Error generating embedding for chunk ${i}:`, error);
                // Use zero vector as fallback
                embeddings.push(new Float32Array(384)); // all-MiniLM-L6-v2 dimension
            }
        }

        return embeddings;
    }

    // Utility function for cosine similarity
    static cosineSimilarity(a, b) {
        if (a.length !== b.length) {
            throw new Error('Vectors must have the same length');
        }

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        if (normA === 0 || normB === 0) {
            return 0;
        }

        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }
}

// Export the embedding generator instance
export const embeddingGenerator = new EmbeddingGenerator();
window.embeddingGenerator = embeddingGenerator;