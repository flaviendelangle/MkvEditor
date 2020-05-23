import { promises as fs } from 'fs'
import path from 'path'

import MkvFileEditor from '../MkvFileEditor'
import { MkvEditorConfig } from '../typings'

class MkvCollectionEditor {
  private readonly root: string
  private readonly config: MkvEditorConfig

  private fileEditors: MkvFileEditor[] = []

  constructor(root: string, config: MkvEditorConfig) {
    this.root = root
    this.config = config
  }

  /**
   * Utils
   */
  private log(message: string, forced: boolean = false) {
    if (this.config.verbose || forced) {
      console.log(message) // eslint-disable-line no-console
    }
  }

  /**
   * Runners
   */
  public async run() {
    this.checkConfigValidity()

    this.log(
      `Running MkvEditor with the following script: ${Object.entries(
        this.config.scripts
      )
        .filter(([, active]) => active)
        .map(([script]) => `- ${script}`)
        .join('\n')}\n\n`,
      true
    )

    const stat = await fs.lstat(this.root)

    if (stat.isDirectory()) {
      await this.runDirectory(this.root)
    }
    if (stat.isFile()) {
      await this.runFile(this.root)
    }

    if (this.config.batch) {
      this.log('\n\nRun batched actions', true)

      for (let i = 0; i < this.fileEditors.length; i++) {
        await this.fileEditors[i].runBatchedActions()
      }
    }
  }

  private async runFile(filePath: string) {
    try {
      const fileEditor = new MkvFileEditor(filePath, this.config)
      await fileEditor.run()

      if (this.config.batch) {
        this.fileEditors.push(fileEditor)
      }
    } catch (e) {
      this.log(`Error while processing ${filePath}`, true)
      this.log(e, true)
    }
  }

  private async runDirectory(directoryPath: string) {
    const children = await fs.readdir(directoryPath)

    for (let i = 0; i < children.length; i++) {
      const childPath = path.join(directoryPath, children[i])
      const stat = await fs.lstat(childPath)

      if (stat.isDirectory()) {
        await this.runDirectory(childPath)
      } else if (childPath.endsWith('.mkv')) {
        await this.runFile(childPath)
      }
    }
  }

  private checkConfigValidity() {
    if (!this.root) {
      throw new Error('No path given')
    }

    if (this.config.batch && Object.keys(this.config.scripts).length > 1) {
      throw new Error(
        'You can only run a single script in batch mode to avoid inconsistencies'
      )
    }
  }
}

export default MkvCollectionEditor
