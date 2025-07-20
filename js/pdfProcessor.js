// js/pdfProcessor.js
class PDFProcessor {
    constructor() {
        this.maxChunkSize = 500; // words per chunk
        this.chunkOverlap = 50;  // overlap between chunks
    }

    async extractTextFromPDF(file) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
            
            let fullText = '';
            const totalPages = pdf.numPages;

            // Extract text from each page
            for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
                const page = await pdf.getPage(pageNum);
                const textContent = await page.getTextContent();
                
                const pageText = textContent.items
                    .map(item => item.str)
                    .join(' ');
                
                fullText += pageText + '\n';
                
                // Update progress callback if provided
                const progress = (pageNum / totalPages) * 50; // 50% for text extraction
                this.onProgress?.(progress, `Extracting text from page ${pageNum}/${totalPages}`);
            }

            return fullText.trim();
        } catch (error) {
            console.error('Error extracting text from PDF:', error);
            throw new Error('Failed to extract text from PDF. The file might be corrupted or password-protected.');
        }
    }

    chunkText(text, documentId) {
        try {
            // Simple word-based chunking
            const words = text.split(/\s+/).filter(word => word.length > 0);
            const chunks = [];
            
            let chunkIndex = 0;
            let startIndex = 0;

            while (startIndex < words.length) {
                const endIndex = Math.min(startIndex + this.maxChunkSize, words.length);
                const chunkWords = words.slice(startIndex, endIndex);
                const chunkText = chunkWords.join(' ');

                if (chunkText.trim().length > 0) {
                    chunks.push({
                        documentId: documentId,
                        chunkIndex: chunkIndex,
                        text: chunkText.trim(),
                        tokenCount: chunkWords.length,
                        embedding: null // Will be filled by embedding module
                    });
                    chunkIndex++;
                }

                // Fixed overlap logic - ensure we always move forward
                if (endIndex >= words.length) {
                    // We've reached the end, break out
                    break;
                } else {
                    // Move forward by (chunkSize - overlap), but ensure minimum progress
                    const nextStart = startIndex + this.maxChunkSize - this.chunkOverlap;
                    startIndex = Math.max(nextStart, startIndex + 1); // Always move at least 1 word forward
                }
            }

            return chunks;
        } catch (error) {
            console.error('Error chunking text:', error);
            throw new Error('Failed to process text into chunks');
        }
    }

    async processDocument(file, documentId, progressCallback) {
        try {
            this.onProgress = progressCallback;

            // Step 1: Extract text (0-50%)
            const fullText = await this.extractTextFromPDF(file);
            
            if (!fullText || fullText.length < 10) {
                throw new Error('PDF appears to be empty or contains no readable text');
            }

            // Step 2: Chunk text (50-60%)
            progressCallback?.(55, 'Creating text chunks...');
            const chunks = this.chunkText(fullText, documentId);
            
            if (chunks.length === 0) {
                throw new Error('No valid text chunks could be created from the document');
            }

            progressCallback?.(60, `Created ${chunks.length} text chunks`);

            return {
                fullText: fullText,
                chunks: chunks,
                stats: {
                    totalWords: fullText.split(/\s+/).length,
                    totalChunks: chunks.length,
                    avgChunkSize: chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0) / chunks.length
                }
            };

        } catch (error) {
            console.error('Error processing document:', error);
            throw error;
        }
    }
}

// Export the processor instance
export const pdfProcessor = new PDFProcessor();
window.pdfProcessor = pdfProcessor;