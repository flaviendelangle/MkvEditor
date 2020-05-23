export const removeExtensionFromFileName = (fileName: string) => {
  if (!fileName.includes('.')) {
    return fileName
  }

  return fileName.split('.').slice(0, -1).join('.')
}
