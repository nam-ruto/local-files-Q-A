// js/app.js - Main application controller
import { documentDB } from './database.js';
import { pdfProcessor } from './pdfProcessor.js';
import { embeddingGenerator } from './embeddings.js';
import { vectorSearch } from './search.js';
import { ui } from './ui.js';

class LocalFilesQAApp {
    constructor() {
        this.isInitialized = false;
        this.embeddingModelLoaded = false;
        this.currentProcessingId = null;
    }

    async initialize() {
        if (this.isInitialized) return;

        try {
            console.log('🚀 Initializing Local Files Q&A App...');
            
            // Load existing documents
            await ui.refreshDocumentList();
            
            // Set up event listeners
            this.setupEventListeners();
            
            // Initial UI state
            ui.disableSearch();
            ui.showStatus('Welcome! Upload a PDF document to get started.', 'info');
            
            this.isInitialized = true;
            console.log('✅ App initialized successfully');
            
        } catch (error) {
            console.error('❌ Error initializing app:', error);
            ui.showStatus(`Initialization error: ${error.message}`, 'error');
        }
    }

    setupEventListeners() {
        // Listen for document upload events
        window.addEventListener('documentUpload', (event) => {
            this.handleDocumentUpload(event.detail);
        });

        // Listen for embedding model initialization requests
        window.addEventListener('initializeEmbeddings', () => {
            this.initializeEmbeddingModel();
        });

        // Handle page reload/close
        window.addEventListener('beforeunload', (event) => {
            if (this.currentProcessingId) {
                event.preventDefault();
                event.returnValue = 'Document is still being processed. Are you sure you want to leave?';
            }
        });
    }

    async handleDocumentUpload({ file, documentId }) {
        this.currentProcessingId = documentId;
        
        try {
            // Initialize embedding model if not already loaded
            if (!this.embeddingModelLoaded) {
                await this.initializeEmbeddingModel();
            }

            // Process the document
            await this.processDocument(file, documentId);
            
        } catch (error) {
            console.error('Error handling document upload:', error);
            await ui.markDocumentError(documentId, error.message);
        } finally {
            this.currentProcessingId = null;
        }
    }

    async initializeEmbeddingModel() {
        if (this.embeddingModelLoaded) return;

        try {
            ui.showStatus('Loading AI model for the first time... This may take a minute.', 'info');
            
            // Add memory check before loading
            if (navigator.deviceMemory && navigator.deviceMemory < 4) {
                ui.showStatus('Warning: Low device memory detected. Model loading may be slow.', 'info');
            }
            
            await embeddingGenerator.initialize((progress, message) => {
                ui.showStatus(`${message} (${Math.round(progress)}%)`, 'info');
            });
            
            this.embeddingModelLoaded = true;
            ui.showStatus('AI model loaded successfully!', 'success');
            
            console.log('✅ Embedding model initialized');
            
        } catch (error) {
            console.error('❌ Error initializing embedding model:', error);
            
            // Suggest solutions based on error type
            let errorMessage = error.message;
            let suggestions = [];
            
            if (error.message.includes('memory')) {
                suggestions.push('Close other browser tabs');
                suggestions.push('Restart your browser');
                suggestions.push('Try using Chrome or Edge for better performance');
            } else if (error.message.includes('timeout') || error.message.includes('network')) {
                suggestions.push('Check your internet connection');
                suggestions.push('Try again in a few minutes');
                suggestions.push('Clear browser cache');
            }
            
            if (suggestions.length > 0) {
                errorMessage += ` Suggestions: ${suggestions.join(', ')}.`;
            }
            
            throw new Error(errorMessage);
        }
    }

    async processDocument(file, documentId) {
        const progressCallback = (progress, message) => {
            ui.updateDocumentProgress(documentId, progress, message);
            documentDB.updateDocument(documentId, { 
                processingProgress: progress 
            });
        };

        try {
            // Step 1: Extract and chunk text (0-60%)
            progressCallback(5, 'Starting PDF processing...');
            
            const pdfResult = await pdfProcessor.processDocument(
                file, 
                documentId, 
                progressCallback
            );

            if (!pdfResult.chunks || pdfResult.chunks.length === 0) {
                throw new Error('No text content could be extracted from the PDF');
            }

            console.log('[app.js - processDocument] pdfResult', pdfResult);
            // Step 2: Generate embeddings (60-90%)
            progressCallback(65, 'Generating AI embeddings...');
            
            const embeddings = await embeddingGenerator.generateEmbeddingsBatch(
                pdfResult.chunks,
                progressCallback
            );
            console.log('[app.js - processDocument] embeddings', embeddings);

            // Step 3: Store chunks with embeddings (90-95%)
            progressCallback(92, 'Saving to database...');
            
            const chunksWithEmbeddings = pdfResult.chunks.map((chunk, index) => ({
                ...chunk,
                embedding: embeddings[index]
            }));

            await documentDB.addChunksBatch(chunksWithEmbeddings);

            // Step 4: Update document metadata (95-100%)
            progressCallback(98, 'Finalizing...');
            
            await documentDB.updateDocument(documentId, {
                totalChunks: pdfResult.chunks.length,
                status: 'ready',
                processingProgress: 100
            });

            // Complete
            progressCallback(100, 'Processing complete!');
            await ui.markDocumentReady(documentId);
            
            console.log(`✅ Document processed: ${pdfResult.stats.totalChunks} chunks, ${pdfResult.stats.totalWords} words`);
            
        } catch (error) {
            console.error('❌ Error processing document:', error);
            throw error;
        }
    }

    // Utility methods for debugging and maintenance
    async getDatabaseInfo() {
        try {
            const stats = await documentDB.getDatabaseStats();
            const documents = await documentDB.getAllDocuments();
            
            return {
                stats,
                documents: documents.map(doc => ({
                    id: doc.id,
                    filename: doc.filename,
                    status: doc.status,
                    chunks: doc.totalChunks,
                    uploadDate: doc.uploadDate
                }))
            };
        } catch (error) {
            console.error('Error getting database info:', error);
            return null;
        }
    }

    async exportDocumentData(documentId) {
        try {
            const document = await documentDB.getDocument(documentId);
            const chunks = await documentDB.getDocumentChunks(documentId);
            
            return {
                document,
                chunks: chunks.map(chunk => ({
                    index: chunk.chunkIndex,
                    text: chunk.text,
                    tokenCount: chunk.tokenCount
                }))
            };
        } catch (error) {
            console.error('Error exporting document data:', error);
            return null;
        }
    }

    async clearAllData() {
        if (!confirm('Are you sure you want to delete all documents and data? This cannot be undone.')) {
            return false;
        }

        try {
            await documentDB.clearAllData();
            await ui.refreshDocumentList();
            ui.disableSearch();
            ui.clearResults();
            ui.showStatus('All data cleared successfully.', 'success');
            
            console.log('🗑️ All data cleared');
            return true;
            
        } catch (error) {
            console.error('Error clearing data:', error);
            ui.showStatus(`Error clearing data: ${error.message}`, 'error');
            return false;
        }
    }

    // Performance monitoring
    getPerformanceInfo() {
        return {
            embeddingModelLoaded: this.embeddingModelLoaded,
            isProcessing: !!this.currentProcessingId,
            currentProcessingId: this.currentProcessingId,
            selectedDocument: ui.selectedDocumentId
        };
    }
}

// Initialize and start the application
const app = new LocalFilesQAApp();

// Make app available globally for debugging
window.app = app;

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    app.initialize();
});

// Export for module usage
export { app };