declare module "pdfjs-dist/build/pdf.mjs" {
  export const GlobalWorkerOptions: { workerSrc: string }
  export function getDocument(source: { data: Uint8Array }): {
    promise: Promise<{
      getPage(pageNumber: number): Promise<{
        getViewport(options: { scale: number; rotation?: number }): { width: number; height: number }
        render(options: {
          canvas: HTMLCanvasElement
          canvasContext: CanvasRenderingContext2D
          viewport: { width: number; height: number }
        }): { promise: Promise<void> }
      }>
      destroy(): Promise<void>
    }>
  }
}
