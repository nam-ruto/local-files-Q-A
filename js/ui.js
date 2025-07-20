// js/ui.js
import { documentDB } from './database.js';
import { vectorSearch } from './search.js';

class UIManager {
    constructor() {
        this.selectedDocumentId = null;
        this.isProcessing = false;
        this.elements = {};
        this.initializeElements();
        this.attachEventListeners();
    }

    initializeElements() {
        // Cache DOM elements
        this.elements = {
            uploadBtn: document.getElementById('uploadBtn'),
            fileInput: document.getElementById('fileInput'),
            documentList: document.getElementById('documentList'),
            queryInput: document.getElementById('queryInput'),
            searchBtn: document.getElementById('searchBtn'),
            resultsContainer: document.getElementById('resultsContainer'),
            statusMessage: document.getElementById('statusMessage')
        };
    }

    attachEventListeners() {
        // File upload
        this.elements.uploadBtn.addEventListener('click', () => {
            this.elements.fileInput.click();
        });

        this.elements.fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleFileUpload(e.target.files[0]);
            }
        });

        // Search functionality
        this.elements.searchBtn.addEventListener('click', () => {
            this.handleSearch();
        });

        this.elements.queryInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSearch();
            }
        });

        // Clear search on input change
        this.elements.queryInput.addEventListener('input', () => {
            if (this.elements.queryInput.value.trim() === '') {
                this.clearResults();
            }
        });
    }

    async handleFileUpload(file) {
        if (!file.type === 'application/pdf') {
            this.showStatus('Please select a PDF file.', 'error');
            return;
        }

        if (file.size > 50 * 1024 * 1024) { // 50MB limit
            this.showStatus('File is too large. Please select a PDF smaller than 50MB.', 'error');
            return;
        }

        try {
            this.setProcessingState(true);
            
            // Create document record
            const documentId = await documentDB.createDocument({
                filename: file.name,
                fileSize: file.size
            });

            // Show processing status
            this.showStatus('Processing document...', 'info');
            await this.refreshDocumentList();

            // Trigger document processing (this will be handled by app.js)
            window.dispatchEvent(new CustomEvent('documentUpload', {
                detail: { file, documentId }
            }));

        } catch (error) {
            console.error('Error handling file upload:', error);
            this.showStatus(`Error uploading file: ${error.message}`, 'error');
            this.setProcessingState(false);
        }
    }

    // Enhanced error handling for document processing
    async markDocumentError(documentId, errorMessage) {
        await documentDB.updateDocument(documentId, {
            status: 'error',
            processingProgress: 0
        });
        
        await this.refreshDocumentList();
        
        // Show retry button for certain errors
        const retryButton = errorMessage.includes('memory') || errorMessage.includes('timeout') 
            ? '<button onclick="location.reload()" style="margin-left: 10px; padding: 4px 8px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer;">Retry</button>'
            : '';
            
        this.showStatus(`Error processing document: ${errorMessage}${retryButton}`, 'error');
        this.setProcessingState(false);
    }

    async handleSearch() {
        const query = this.elements.queryInput.value.trim();
        
        if (!query) {
            this.showStatus('Please enter a question to search.', 'error');
            return;
        }

        if (!this.selectedDocumentId) {
            this.showStatus('Please select a document to search.', 'error');
            return;
        }

        try {
            this.setSearchState(true);
            this.showStatus('Searching...', 'info');

            // Perform search
            const searchResults = await vectorSearch.hybridSearch(
                query, 
                this.selectedDocumentId, 
                5
            );

            // Display results
            this.displaySearchResults(searchResults);
            this.clearStatus();

        } catch (error) {
            console.error('Error during search:', error);
            this.showStatus(`Search error: ${error.message}`, 'error');
        } finally {
            this.setSearchState(false);
        }
    }

    async refreshDocumentList() {
        try {
            const documents = await documentDB.getAllDocuments();
            this.renderDocumentList(documents);
        } catch (error) {
            console.error('Error refreshing document list:', error);
            this.showStatus('Error loading documents.', 'error');
        }
    }

    renderDocumentList(documents) {
        if (documents.length === 0) {
            this.elements.documentList.innerHTML = `
                <div class="empty-state">
                    <h3>No documents yet</h3>
                    <p>Upload your first PDF to get started</p>
                </div>
            `;
            return;
        }

        const documentsHtml = documents.map(doc => {
            const isSelected = doc.id === this.selectedDocumentId;
            const statusClass = doc.status || 'ready';
            const statusText = this.getStatusText(doc.status);
            const uploadDate = new Date(doc.uploadDate).toLocaleDateString();
            
            return `
                <div class="document-item ${isSelected ? 'selected' : ''}" 
                     data-doc-id="${doc.id}">
                    <div class="doc-name">${doc.filename}</div>
                    <div class="doc-meta">
                        Uploaded: ${uploadDate}<br>
                        Chunks: ${doc.totalChunks || 0} | Size: ${this.formatFileSize(doc.fileSize)}
                    </div>
                    <div class="doc-status ${statusClass}">${statusText}</div>
                    ${doc.status === 'processing' ? this.renderProgressBar(doc.processingProgress || 0) : ''}
                    <div class="doc-actions">
                        <button class="doc-btn select-btn" ${doc.status !== 'ready' ? 'disabled' : ''}>
                            ${isSelected ? 'Selected' : 'Select'}
                        </button>
                        <button class="doc-btn delete" onclick="ui.deleteDocument(${doc.id})">
                            Delete
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        this.elements.documentList.innerHTML = documentsHtml;

        // Attach click listeners for document selection
        this.elements.documentList.querySelectorAll('.document-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (!e.target.classList.contains('doc-btn')) {
                    const docId = parseInt(item.dataset.docId);
                    const doc = documents.find(d => d.id === docId);
                    if (doc && doc.status === 'ready') {
                        this.selectDocument(docId);
                    }
                }
            });
        });
    }

    renderProgressBar(progress) {
        return `
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${progress}%"></div>
            </div>
        `;
    }

    selectDocument(documentId) {
        this.selectedDocumentId = documentId;
        this.enableSearch();
        this.refreshDocumentList();
        this.clearResults();
        
        // Update query input placeholder
        const doc = this.elements.documentList.querySelector(`[data-doc-id="${documentId}"]`);
        if (doc) {
            const filename = doc.querySelector('.doc-name').textContent;
            this.elements.queryInput.placeholder = `Ask a question about ${filename}...`;
        }
    }

    async deleteDocument(documentId) {
        if (!confirm('Are you sure you want to delete this document? This action cannot be undone.')) {
            return;
        }

        try {
            await documentDB.deleteDocument(documentId);
            
            if (this.selectedDocumentId === documentId) {
                this.selectedDocumentId = null;
                this.disableSearch();
                this.clearResults();
            }
            
            await this.refreshDocumentList();
            this.showStatus('Document deleted successfully.', 'success');
            
        } catch (error) {
            console.error('Error deleting document:', error);
            this.showStatus(`Error deleting document: ${error.message}`, 'error');
        }
    }

    displaySearchResults(searchResults) {
        const formatted = vectorSearch.formatSearchResults(searchResults);
        
        if (formatted.count === 0) {
            this.elements.resultsContainer.innerHTML = formatted.html;
        } else {
            const header = `
                <div style="margin-bottom: 16px; color: #64748b; font-size: 14px;">
                    Found ${formatted.count} relevant chunks from ${formatted.totalSearched} total chunks
                </div>
            `;
            this.elements.resultsContainer.innerHTML = header + formatted.html;
        }
    }

    clearResults() {
        this.elements.resultsContainer.innerHTML = `
            <div class="empty-state">
                <h3>Ready to search</h3>
                <p>Ask a question about your selected document</p>
            </div>
        `;
    }

    // Status and UI state management
    showStatus(message, type = 'info') {
        this.elements.statusMessage.innerHTML = `
            <div class="status-message ${type}">
                ${message}
            </div>
        `;
    }

    clearStatus() {
        this.elements.statusMessage.innerHTML = '';
    }

    setProcessingState(isProcessing) {
        this.isProcessing = isProcessing;
        this.elements.uploadBtn.disabled = isProcessing;
        this.elements.uploadBtn.textContent = isProcessing ? '⏳ Processing...' : '📄 Upload PDF';
    }

    setSearchState(isSearching) {
        this.elements.searchBtn.disabled = isSearching;
        this.elements.queryInput.disabled = isSearching;
        this.elements.searchBtn.textContent = isSearching ? '⏳ Searching...' : '🔍 Search';
    }

    enableSearch() {
        this.elements.queryInput.disabled = false;
        this.elements.searchBtn.disabled = false;
    }

    disableSearch() {
        this.elements.queryInput.disabled = true;
        this.elements.searchBtn.disabled = true;
        this.elements.queryInput.placeholder = 'Select a document to start asking questions...';
    }

    // Utility functions
    getStatusText(status) {
        switch (status) {
            case 'processing': return 'Processing...';
            case 'ready': return 'Ready';
            case 'error': return 'Error';
            default: return 'Ready';
        }
    }

    formatFileSize(bytes) {
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        if (bytes === 0) return '0 Bytes';
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }

    // Update progress for document processing
    updateDocumentProgress(documentId, progress, message) {
        const docElement = this.elements.documentList.querySelector(`[data-doc-id="${documentId}"]`);
        if (docElement) {
            const progressBar = docElement.querySelector('.progress-fill');
            if (progressBar) {
                progressBar.style.width = `${progress}%`;
            }
        }
        
        if (message) {
            this.showStatus(message, 'info');
        }
    }

    // Mark document as ready
    async markDocumentReady(documentId) {
        await documentDB.updateDocument(documentId, {
            status: 'ready',
            processingProgress: 100
        });
        
        await this.refreshDocumentList();
        this.showStatus('Document processed successfully! You can now ask questions.', 'success');
        this.setProcessingState(false);
    }

    // Mark document as error
    async markDocumentError(documentId, errorMessage) {
        await documentDB.updateDocument(documentId, {
            status: 'error',
            processingProgress: 0
        });
        
        await this.refreshDocumentList();
        this.showStatus(`Error processing document: ${errorMessage}`, 'error');
        this.setProcessingState(false);
    }
}

// Export the UI manager instance
export const ui = new UIManager();
window.ui = ui;