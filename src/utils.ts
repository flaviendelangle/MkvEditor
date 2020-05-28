import { promises as fs } from 'fs'

export const removeExtensionFromFileName = (fileName: string) => {
  if (!fileName.includes('.')) {
    return fileName
  }

  return fileName.split('.').slice(0, -1).join('.')
}

export const createDirectory = async (directoryPath: string) => {
  try {
    await fs.access(directoryPath)
  } catch {
    return fs.mkdir(directoryPath)
  }
}
