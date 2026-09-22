/**
 * unzipper optionally supports S3 URLs and lazily requires @aws-sdk/client-s3
 * inside that code path. Puxl only ever reads local files, so the optional
 * dependency is aliased to this stub instead of shipping a second SDK.
 */
class UnsupportedOperation extends Error {
  constructor() {
    super('S3 support is not bundled in Puxl; only local files can be opened.')
  }
}

export class S3Client {
  constructor() {
    throw new UnsupportedOperation()
  }
}

export class GetObjectCommand {
  constructor() {
    throw new UnsupportedOperation()
  }
}

export class HeadObjectCommand {
  constructor() {
    throw new UnsupportedOperation()
  }
}

export default { S3Client, GetObjectCommand, HeadObjectCommand }
