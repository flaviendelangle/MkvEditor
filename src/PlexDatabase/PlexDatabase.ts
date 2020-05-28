import path from 'path'
import { Database } from 'sqlite3'

import CacheManager from '../CacheManager'

type PlexDatabaseParams = {
  cache: CacheManager
}

class PlexDatabase {
  private readonly cache: CacheManager

  private db: Database | undefined

  constructor(params: PlexDatabaseParams) {
    this.cache = params.cache
  }

  private async get<Value = any>(query: string, params: any): Promise<any> {
    return new Promise((resolve, reject) =>
      this.db?.get(query, params, (err: Error, data: Value) => {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      })
    )
  }

  public async connect() {
    const { plexFolder } = await this.cache.fetchConfig()

    this.db = new Database(
      path.join(
        plexFolder,
        'Plug-in Support',
        'Databases',
        'com.plexapp.plugins.library.db'
      )
    )
  }

  public close() {}
}

export default PlexDatabase
