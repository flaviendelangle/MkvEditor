import commander from 'commander'

import MkvCollectionEditor from './MkvCollectionEditor'
import { CliConfig, MkvEditorScript } from './typings'

type ScriptConfig = {
  isRunByDefault: boolean
}

const SCRIPT_CONFIGS: Record<MkvEditorScript, ScriptConfig> = {
  [MkvEditorScript.addMissingLanguages]: {
    isRunByDefault: true,
  },
  [MkvEditorScript.addMissingLanguages]: {
    isRunByDefault: true,
  },
  [MkvEditorScript.sanitizeTitle]: {
    isRunByDefault: true,
  },
  [MkvEditorScript.setDefaultSubtitle]: {
    isRunByDefault: true,
  },
  [MkvEditorScript.promptDefaultAudioLanguage]: {
    isRunByDefault: false,
  },
  [MkvEditorScript.removeUselessAudioTracks]: {
    isRunByDefault: false,
  },
  [MkvEditorScript.extractSubtitles]: {
    isRunByDefault: false,
  },
}

const run = async (root: string, command: commander.Command) => {
  const rawScripts = command.scripts || 'default'

  let scripts: MkvEditorScript[]

  if (rawScripts === 'all') {
    scripts = Object.values(MkvEditorScript)
  } else if (rawScripts === 'default') {
    scripts = Object.values(MkvEditorScript).filter(
      (script) => SCRIPT_CONFIGS[script]?.isRunByDefault
    )
  } else {
    scripts = rawScripts
      .split(',')
      .map((script: string) => script.trim())
      .filter((script: MkvEditorScript) => !!SCRIPT_CONFIGS[script])
  }

  const config: CliConfig = {
    verbose: command.verbose,
    debug: command.debug,
    batch: command.batch,
    scripts: Object.fromEntries(
      scripts.map((script: MkvEditorScript) => [script, true])
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
  .option('-b --batch', 'Batch mode (execute all heavy queries)')
  .option(
    '-s, --scripts <type>',
    `Script(s) to run (all, default, ${Object.values(MkvEditorScript).join(
      ', '
    )})`
  )
  .action((cmd) => {
    root = cmd
  })
  .parse(process.argv)

run(root, program)
