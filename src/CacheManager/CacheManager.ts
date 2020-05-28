import { promises as fs } from 'fs'
import inquirer from 'inquirer'
import path from 'path'

import { GlobalConfig } from '../typings'
import { createDirectory } from '../utils'

class CacheManager {
  private static ROOT_FOLDER_NAME = '.mkv-editor'
  private static CONTENT_FOLDER_NAME = 'content'
  private static CONFIG_FILE_NAME = 'config.json'

  private isReady: boolean = false
  private config: GlobalConfig | null = null

  get rootPath() {
    return path.join(process.env.HOME ?? '', CacheManager.ROOT_FOLDER_NAME)
  }

  get contentCachePath() {
    return path.join(this.rootPath, CacheManager.CONTENT_FOLDER_NAME)
  }

  private async prepare() {
    if (this.isReady) {
      return
    }

    await createDirectory(this.rootPath)
    await createDirectory(this.contentCachePath)

    this.isReady = true
  }

  public async fetchConfig(): Promise<GlobalConfig> {
    if (this.config) {
      return this.config
    }

    await this.prepare()

    const configPath = path.join(this.rootPath, CacheManager.CONFIG_FILE_NAME)

    try {
      const content = await fs.readFile(configPath, 'utf8')

      return JSON.parse(content)
    } catch {
      // eslint-disable-next-line
      console.log('First time using MKV Editor ? We need a few information\n\n')
      const config = await inquirer.prompt<GlobalConfig>([
        {
          name: 'plexFolder',
          message: 'Where is your Plex server installed ?',
        },
      ])

      await fs.writeFile(configPath, JSON.stringify(config, null, 2))

      return config
    }
  }

  async upsertFile(fileName: string, content: string) {
    await this.prepare()
    await fs.writeFile(path.join(this.contentCachePath, fileName), content)
  }
}

export default CacheManager
