declare module '@ctrl/video-filename-parser' {
  type TitleInformation = {
    title?: string
    year?: string
    source?: string
    resolution?: string
    codec?: string
    group?: string
  }

  export const filenameParse: (title: string) => TitleInformation
}
