import { MkvDetails, TrackTypes } from '../typings'

export const DEFAULT_MKV_DETAILS: MkvDetails = {
  file_name: '',
  warnings: [],
  errors: [],
  attachments: [],
  chapters: [],
  tracks: [],
  container: {
    properties: {
      title: '',
    },
  },
}

type TrackTypeConfig = {
  mkvmerge: {
    stripFromFileFlag: string
  }
}

export const TRACK_TYPE_CONFIGS: Record<TrackTypes, TrackTypeConfig> = {
  [TrackTypes.video]: {
    mkvmerge: {
      stripFromFileFlag: 'd',
    },
  },
  [TrackTypes.audio]: {
    mkvmerge: {
      stripFromFileFlag: 'a',
    },
  },
  [TrackTypes.subtitles]: {
    mkvmerge: {
      stripFromFileFlag: 's',
    },
  },
}
