import { exec } from 'child_process'
import { promises as fs } from 'fs'
import inquirer from 'inquirer'
import path from 'path'

import {
  MkvEditorConfig,
  MkvDetails,
  TrackTypes,
  MkvEditorScript,
  Track,
} from '../typings'

import { DEFAULT_MKV_DETAILS, TRACK_TYPE_CONFIGS } from './MkvFileEditor.config'

class MkvFileEditor {
  private static CACHE_FOLDER = '.mkv_cache'
  private static FILE_TITLE_REGEXP = /(.*) \(([0-9]{4})\)\.mkv/

  private filePath: string
  private readonly config: MkvEditorConfig

  private mkvDetails: MkvDetails = DEFAULT_MKV_DETAILS

  private batchedActions: (() => Promise<void>)[] = []

  constructor(filePath: string, config: MkvEditorConfig) {
    this.filePath = filePath
    this.config = config
  }

  /**
   * Getters
   */
  get fileName() {
    return path.basename(this.filePath)
  }

  get fileNameWithoutExtension() {
    return this.fileName.split('.').slice(0, -1).join('.')
  }

  get fileDirectory() {
    return path.dirname(this.filePath)
  }

  get subtitleTracks() {
    return this.mkvDetails.tracks.filter(
      (track) => track.type === TrackTypes.subtitles
    )
  }

  get audioTracks() {
    return this.mkvDetails.tracks.filter(
      (track) => track.type === TrackTypes.subtitles
    )
  }

  /**
   * Utils
   */
  private log(message: string, forced: boolean = false) {
    if (this.config.verbose || forced) {
      console.log(message) // eslint-disable-line no-console
    }
  }

  private async fetchFileDetails() {
    const response = await this.execQuery(`mkvmerge -J "${this.filePath}"`)
    this.mkvDetails = JSON.parse(response)
  }

  private async execQuery(query: string) {
    this.log(`Exec query: ${query}`)

    return new Promise<any>((resolve, reject) =>
      exec(query, (error, stdout) => {
        if (error) {
          reject(error)
        } else {
          resolve(stdout)
        }
      })
    )
  }

  private async execAction(action: () => Promise<void>) {
    if (this.config.batch) {
      this.batchedActions.push(action)
    } else {
      return action()
    }
  }

  /**
   * Runners
   */
  public async run() {
    this.log(`\nRun ${this.fileName}`)

    await this.fetchFileDetails()

    if (this.config.debug) {
      try {
        await fs.access(MkvFileEditor.CACHE_FOLDER)
      } catch {
        return fs.mkdir(MkvFileEditor.CACHE_FOLDER)
      }

      await fs.writeFile(
        `${path.join(MkvFileEditor.CACHE_FOLDER, this.fileName)}.txt`,
        JSON.stringify(this.mkvDetails, null, 2)
      )
    }

    if (this.config.scripts[MkvEditorScript.addMissingLanguages]) {
      await this.addMissingLanguages(TrackTypes.audio)
      await this.addMissingLanguages(TrackTypes.subtitles)
    }

    if (this.config.scripts[MkvEditorScript.promptDefaultAudioLanguage]) {
      await this.promptDefaultAudioLanguage()
    }

    if (this.config.scripts[MkvEditorScript.setDefaultSubtitle]) {
      await this.setDefaultSubtitle()
    }

    if (this.config.scripts[MkvEditorScript.removeUselessAudioTracks]) {
      await this.removeUselessAudioTracks()
    }

    if (this.config.scripts[MkvEditorScript.addYearToFileName]) {
      await this.addYearToFileName()
    }

    if (this.config.scripts[MkvEditorScript.updateContainerTitle]) {
      await this.updateTitle()
    }

    if (this.config.scripts[MkvEditorScript.extractSubtitles]) {
      await this.extractSubtitles()
    }
  }

  public async runBatchedActions() {
    if (!this.batchedActions.length) {
      return
    }

    this.log(`\nRun batched actions for ${this.fileName}`)

    for (let i = 0; i < this.batchedActions.length; i++) {
      await this.batchedActions[i]()
    }

    this.batchedActions = []
  }

  /**
   * Scripts
   */

  private async addMissingLanguages(type: TrackTypes) {
    const tracks = this.mkvDetails.tracks.filter((track) => track.type === type)

    for (let i = 0; i < tracks.length; i++) {
      const { properties } = tracks[i]

      const amountOfSameType = tracks.length

      if (properties.language === 'und') {
        const { language } = await inquirer.prompt<{ language: string }>([
          {
            name: 'language',
            message: `New language for ${this.fileName} : ${type} ${
              i + 1
            } of ${amountOfSameType}`,
          },
        ])

        if (language) {
          await this.execQuery(
            `mkvpropedit "${this.mkvDetails.file_name}" --edit track:@${properties.number} --set language=${language}`
          )
          this.log('Track updated', true)
        } else {
          this.log('Track ignored', true)
        }
      }
    }
  }

  private async promptDefaultAudioLanguage() {
    const audioTracks = this.audioTracks

    const currentDefaultAudioLanguage = audioTracks.find(
      (track) => track.properties.default_track
    )?.properties?.language

    if (audioTracks.length === 1 && !currentDefaultAudioLanguage) {
      await this.setDefaultTrack(audioTracks, audioTracks[0])
    }

    if (
      new Set(audioTracks.map((track) => track.properties.language)).size > 1
    ) {
      const { language } = await inquirer.prompt<{ language: string }>([
        {
          name: 'language',
          message: `New language for ${this.fileName} : ${audioTracks
            .map((track) => track.properties.language)
            .join(', ')}`,
          default:
            currentDefaultAudioLanguage ?? audioTracks[0].properties.language,
        },
      ])

      const newDefaultAudioTrack = audioTracks.find(
        (track) => track.properties.language === language
      )

      if (!newDefaultAudioTrack) {
        this.log('The language you gave does not exist', true)
        await this.promptDefaultAudioLanguage()
      } else {
        await this.setDefaultTrack(audioTracks, newDefaultAudioTrack)
      }
    }
  }

  private async setDefaultSubtitle() {
    const audioLanguage = this.mkvDetails.tracks.find(
      (track) =>
        track.type === TrackTypes.audio && track.properties.default_track
    )?.properties?.language

    const subtitleTracks = this.subtitleTracks

    const currentDefaultSubtitleLanguage = subtitleTracks.find(
      (track) => track.properties.default_track
    )?.properties?.language

    let defaultSubtitleTrack: Track | null = null

    if (audioLanguage && subtitleTracks.length) {
      if (audioLanguage === 'fre') {
        defaultSubtitleTrack = null
      } else if (audioLanguage === 'eng') {
        defaultSubtitleTrack =
          subtitleTracks.find((track) => track.properties.language === 'eng') ??
          null

        if (!defaultSubtitleTrack) {
          defaultSubtitleTrack =
            subtitleTracks.find(
              (track) => track.properties.language === 'fr'
            ) ?? null
        }
      } else {
        defaultSubtitleTrack =
          subtitleTracks.find((track) => track.properties.language === 'fr') ??
          null

        if (!defaultSubtitleTrack) {
          defaultSubtitleTrack =
            subtitleTracks.find(
              (track) => track.properties.language === 'eng'
            ) ?? null
        }
      }
    }

    if (defaultSubtitleTrack) {
      if (
        currentDefaultSubtitleLanguage !==
        defaultSubtitleTrack.properties.language
      ) {
        await this.setDefaultTrack(subtitleTracks, defaultSubtitleTrack)
      }
    } else if (subtitleTracks.length) {
      this.log('No default subtitle found')
    }
  }

  private async removeUselessAudioTracks() {
    const defaultAudioLanguage = this.audioTracks.find(
      (track) => track.properties.default_track
    )?.properties?.language

    if (!defaultAudioLanguage) {
      return
    }

    const uselessAudioTracks = this.audioTracks.filter(
      (track) =>
        track.properties.language !== defaultAudioLanguage &&
        track.properties.language !== 'fre'
    )

    if (uselessAudioTracks.length) {
      await this.removeTracks(uselessAudioTracks)
    }
  }

  private async addYearToFileName() {
    const match = MkvFileEditor.FILE_TITLE_REGEXP.exec(this.fileName)

    if (!match) {
      const { year } = await inquirer.prompt<{ year: string }>([
        {
          name: 'year',
          message: `Release year of ${this.fileName} :`,
        },
      ])

      if (year) {
        const newFileName = `${this.fileNameWithoutExtension} (${year}).mkv`

        const newFilePath = path.join(this.fileDirectory, newFileName)

        this.log(`Rename file ${this.fileName} => ${newFileName}`)
        await fs.rename(this.mkvDetails.file_name, newFilePath)

        this.filePath = newFilePath
        await this.fetchFileDetails()
      }
    }
  }

  private async updateTitle() {
    const currentTitle = this.mkvDetails.container.properties.title

    const match = MkvFileEditor.FILE_TITLE_REGEXP.exec(this.fileName)

    if (match) {
      const newTitle = match[1]

      if (newTitle !== currentTitle) {
        this.log(`Update title ${currentTitle} => ${newTitle}`)
        await this.execQuery(
          `mkvpropedit "${this.mkvDetails.file_name}" --edit info --set "title=${newTitle}"`
        )
      }
    } else {
      this.log('Cannot parse file name')
    }
  }

  private async extractSubtitles() {
    const subtitleTracks = this.subtitleTracks

    if (!subtitleTracks.length) {
      return
    }

    const { index } = await inquirer.prompt<{ index: number }>([
      {
        name: 'index',
        message: `Subtitle of ${this.fileName} to extract ${subtitleTracks.map(
          (track, trackIndex) => `${trackIndex} (${track.properties.language})`
        )})`,
        type: 'number',
        default: 0,
      },
    ])

    const trackToExtract = subtitleTracks[index]

    if (trackToExtract) {
      const trackPath = path.join(
        this.fileDirectory,
        `${this.fileNameWithoutExtension}.${trackToExtract.properties.language}.sub`
      )

      await this.execAction(async () => {
        await this.execQuery(
          `mkvextract "${this.filePath}" tracks ${trackToExtract.id}:"${trackPath}"`
        )
      })
    } else {
      this.log('Invalid track index', true)
      await this.extractSubtitles()
    }
  }

  /**
   * Mutations
   */
  private async setDefaultTrack(tracks: Track[], defaultTrack: Track) {
    const tracksCommand = tracks
      .map(
        (track) =>
          `--edit track:@${track.properties.number} --set flag-default=${
            track.id === defaultTrack.id
          }`
      )
      .join(' ')

    await this.execQuery(
      `mkvpropedit "${this.mkvDetails.file_name}" ${tracksCommand}`
    )
    await this.fetchFileDetails()

    this.log(
      `New default ${defaultTrack.type} : ${defaultTrack.properties.language}`
    )
  }

  private async removeTracks(tracksToRemove: Track[]) {
    if (
      tracksToRemove.length === 0 ||
      new Set(tracksToRemove.map((track) => track.type)).size > 1
    ) {
      this.log('Invalid track list', true)
      return
    }

    const tracksType = tracksToRemove[0].type
    const tracksToKeepIds = this.mkvDetails.tracks
      .filter(
        (track) =>
          track.type === tracksType &&
          tracksToRemove.every((trackBis) => trackBis.id !== track.id)
      )
      .map((track) => track.id)

    const noTrackFlag =
      TRACK_TYPE_CONFIGS[tracksType].mkvmerge.stripFromFileFlag

    const tempFilePath = `${this.filePath}.temp`

    const { isConfirmed } = await inquirer.prompt<{ isConfirmed: string }>([
      {
        name: 'isConfirmed',
        message: `Tracks of type ${tracksType} to remove : ${tracksToRemove.map(
          (track) => track.properties.language
        )}`,
        default: 'yes',
      },
    ])

    if (['y', 'yes'].includes(`${isConfirmed}`.toLowerCase())) {
      await this.execAction(async () => {
        await this.execQuery(
          `mkvmerge -o "${tempFilePath}" -${noTrackFlag} ${tracksToKeepIds.join(
            ','
          )} "${this.filePath}"`
        )
        await fs.unlink(this.filePath)
        await fs.rename(tempFilePath, this.filePath)
        await this.fetchFileDetails()
      })
    } else {
      this.log('Modification ignored')
    }
  }
}

export default MkvFileEditor
