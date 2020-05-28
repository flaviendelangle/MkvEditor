import { filenameParse } from '@ctrl/video-filename-parser'
import { exec } from 'child_process'
import { promises as fs } from 'fs'
import inquirer from 'inquirer'
import path from 'path'

import CacheManager from '../CacheManager'
import {
  CliConfig,
  MkvDetails,
  TrackTypes,
  MkvEditorScript,
  Track,
} from '../typings'
import { removeExtensionFromFileName } from '../utils'

import { DEFAULT_MKV_DETAILS, TRACK_TYPE_CONFIGS } from './MkvFileEditor.config'

type MkvFileEditorParams = {
  filePath: string
  config: CliConfig
  cache?: CacheManager
}

class MkvFileEditor {
  private static FILE_TITLE_REGEXP = /^([^(]+) \(([0-9]{4})\)$/

  private filePath: string
  private readonly config: CliConfig

  private mkvDetails: MkvDetails = DEFAULT_MKV_DETAILS

  private batchedActions: (() => Promise<void>)[] = []

  private readonly cache: CacheManager

  constructor(params: MkvFileEditorParams) {
    this.filePath = params.filePath
    this.config = params.config
    this.cache = params.cache ?? new CacheManager()
  }

  /**
   * Getters
   */
  get fileName() {
    return path.basename(this.filePath)
  }

  get fileNameWithoutExtension() {
    return removeExtensionFromFileName(this.fileName)
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
      (track) => track.type === TrackTypes.audio
    )
  }

  /**
   * Utils
   */
  private log(message: string, forced: boolean = false) {
    if (this.config.verbose || forced) {
      const prefix = this.config.verbose
        ? ''
        : `${this.fileNameWithoutExtension} `
      console.log(`${prefix} ${message}`) // eslint-disable-line no-console
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
    this.log(`\nProcess ${this.fileName}`)

    await this.fetchFileDetails()

    await this.cache.fetchConfig()

    if (this.config.debug) {
      await this.cache.upsertFile(
        `${this.fileName}.txt`,
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

    if (this.config.scripts[MkvEditorScript.sanitizeTitle]) {
      await this.sanitizeTitle()
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
            `mkvpropedit "${this.filePath}" --edit track:@${properties.number} --set language=${language}`
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

  private async sanitizeTitle() {
    const titleMatch = MkvFileEditor.FILE_TITLE_REGEXP.exec(
      this.fileNameWithoutExtension
    )

    if (!titleMatch) {
      const fileInfo = filenameParse(this.fileName)

      const { title, year } = await inquirer.prompt<{
        year: string
        title: string
      }>([
        {
          name: 'title',
          message: `Title of ${this.fileName}`,
          default: fileInfo.title
            ? removeExtensionFromFileName(fileInfo.title).trim()
            : '',
        },
        {
          name: 'year',
          message: `Release year of ${this.fileName} :`,
          year: fileInfo.year,
        },
      ])

      if (!year || !title) {
        this.log('Missing informations', true)
        await this.sanitizeTitle()
      } else {
        const newFileName = `${title} (${year}).mkv`

        const newFilePath = path.join(this.fileDirectory, newFileName)

        await fs.rename(this.filePath, newFilePath)
        this.filePath = newFilePath
        this.log(`File renamed: ${this.fileName} => ${newFileName}`, true)
      }
    }

    const newTitleMatch = MkvFileEditor.FILE_TITLE_REGEXP.exec(
      this.fileNameWithoutExtension
    )

    if (!newTitleMatch) {
      this.log('Something went wrong', true)
    } else {
      const containerTitle = this.mkvDetails.container.properties.title
      const newTitle = newTitleMatch[1]

      if (newTitle !== containerTitle) {
        await this.execQuery(
          `mkvpropedit "${this.filePath}" --edit info --set "title=${newTitle}"`
        )
        this.log(
          `Container title updated: ${containerTitle} => ${newTitle}`,
          true
        )
      }
    }

    await this.fetchFileDetails()
  }

  private async extractSubtitles() {
    /*
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
    */
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

    await this.execQuery(`mkvpropedit "${this.filePath}" ${tracksCommand}`)
    await this.fetchFileDetails()

    this.log(
      `New default ${defaultTrack.type} : ${defaultTrack.properties.language}`,
      true
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
