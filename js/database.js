// js/database.js
class DocumentDatabase {
    constructor() {
        this.db = new Dexie('LocalFilesQA');
        this.setupSchema();
    }

    setupSchema() {
        this.db.version(1).stores({
            documents: '++id, filename, uploadDate, totalChunks, fileSize, status, processingProgress',
            chunks: '++id, documentId, chunkIndex, text, embedding, tokenCount'
        });

        // Open the database
        this.db.open().catch(err => {
            console.error('Failed to open database:', err);
        });
    }

    // Document operations
    async createDocument(documentData) {
        try {
            const id = await this.db.documents.add({
                filename: documentData.filename,
                uploadDate: new Date(),
                totalChunks: 0,
                fileSize: documentData.fileSize,
                status: 'processing',
                processingProgress: 0
            });
            return id;
        } catch (error) {
            console.error('Error creating document:', error);
            throw error;
        }
    }

    async getAllDocuments() {
        try {
            return await this.db.documents.orderBy('uploadDate').reverse().toArray();
        } catch (error) {
            console.error('Error fetching documents:', error);
            return [];
        }
    }

    async getDocument(id) {
        try {
            return await this.db.documents.get(id);
        } catch (error) {
            console.error('Error fetching document:', error);
            return null;
        }
    }

    async updateDocument(id, updates) {
        try {
            await this.db.documents.update(id, updates);
        } catch (error) {
            console.error('Error updating document:', error);
            throw error;
        }
    }

    async deleteDocument(id) {
        try {
            // Delete all chunks first
            await this.db.chunks.where('documentId').equals(id).delete();
            // Then delete the document
            await this.db.documents.delete(id);
        } catch (error) {
            console.error('Error deleting document:', error);
            throw error;
        }
    }

    // Chunk operations
    async addChunk(chunkData) {
        try {
            return await this.db.chunks.add({
                documentId: chunkData.documentId,
                chunkIndex: chunkData.chunkIndex,
                text: chunkData.text,
                embedding: chunkData.embedding, // Float32Array
                tokenCount: chunkData.tokenCount
            });
        } catch (error) {
            console.error('Error adding chunk:', error);
            throw error;
        }
    }

    async addChunksBatch(chunks) {
        try {
            return await this.db.chunks.bulkAdd(chunks);
        } catch (error) {
            console.error('Error adding chunks batch:', error);
            throw error;
        }
    }

    async getDocumentChunks(documentId) {
        try {
            return await this.db.chunks
                .where('documentId')
                .equals(documentId)
                .toArray()
                .then(chunks => chunks.sort((a, b) => a.chunkIndex - b.chunkIndex));
        } catch (error) {
            console.error('Error fetching chunks:', error);
            return [];
        }
    }

    async getAllChunks() {
        try {
            return await this.db.chunks.toArray();
        } catch (error) {
            console.error('Error fetching all chunks:', error);
            return [];
        }
    }

    // Search operations
    async searchChunks(documentId, limit = 5) {
        try {
            let query = this.db.chunks;
            
            if (documentId) {
                query = query.where('documentId').equals(documentId);
            }
            
            return await query.limit(limit).toArray();
        } catch (error) {
            console.error('Error searching chunks:', error);
            return [];
        }
    }

    // Utility methods
    async getDatabaseStats() {
        try {
            const docCount = await this.db.documents.count();
            const chunkCount = await this.db.chunks.count();
            
            return {
                documents: docCount,
                chunks: chunkCount
            };
        } catch (error) {
            console.error('Error getting database stats:', error);
            return { documents: 0, chunks: 0 };
        }
    }

    async clearAllData() {
        try {
            await this.db.chunks.clear();
            await this.db.documents.clear();
        } catch (error) {
            console.error('Error clearing database:', error);
            throw error;
        }
    }
}

// Export the database instance
export const documentDB = new DocumentDatabase();
window.documentDB = documentDB;