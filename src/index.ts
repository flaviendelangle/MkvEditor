import commander from 'commander'

import MkvCollectionEditor from './MkvCollectionEditor'
import { MkvEditorConfig, MkvEditorScript } from './typings'

type ScriptConfig = {
  isRunByDefault: boolean
}

const SCRIPT_CONFIGS: Record<MkvEditorScript, ScriptConfig> = {
  [MkvEditorScript.addMissingLanguages]: {
    isRunByDefault: true,
  },
  [MkvEditorScript.addYearToFileName]: {
    isRunByDefault: true,
  },
  [MkvEditorScript.addMissingLanguages]: {
    isRunByDefault: true,
  },
  [MkvEditorScript.promptDefaultAudioLanguage]: {
    isRunByDefault: true,
  },
  [MkvEditorScript.removeUselessAudioTracks]: {
    isRunByDefault: false,
  },
  [MkvEditorScript.updateContainerTitle]: {
    isRunByDefault: true,
  },
  [MkvEditorScript.setDefaultSubtitle]: {
    isRunByDefault: true,
  },
  [MkvEditorScript.extractSubtitles]: {
    isRunByDefault: false,
  },
}

const run = async (root: string, command: commander.Command) => {
  const config: MkvEditorConfig = {
    verbose: command.verbose,
    debug: command.debug,
    batch: command.batch,
    scripts: Object.fromEntries(
      (command.scripts
        ? command.scripts
            .split(',')
            .map((script: string) => script.trim())
            .filter((script: MkvEditorScript) => !!SCRIPT_CONFIGS[script])
        : Object.values(MkvEditorScript).filter(
            (script) => SCRIPT_CONFIGS[script]?.isRunByDefault
          )
      ).map((script: MkvEditorScript) => [script, true])
    ),
  }

  const editor = new MkvCollectionEditor(root, config)
  await editor.run()
}

const program = new commander.Command()
let root: string = ''

program
  .arguments('<cdm> [en]')
  .option('-v, --verbose', 'Verbose mode')
  .option('-d, --debug', 'Debug mode')
  .option('-b --batch', 'Batch mode (execute all heavy queries')
  .option(
    '-s, --scripts <type>',
    `Script to run (${Object.values(MkvEditorScript).join(', ')})`
  )
  .action((cmd) => {
    root = cmd
  })
  .parse(process.argv)

run(root, program)
