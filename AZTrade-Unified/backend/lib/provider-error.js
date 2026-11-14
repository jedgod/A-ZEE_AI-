export class ProviderUnavailableError extends Error {
  constructor(message='Licensed market-data provider unavailable'){super(message);this.name='ProviderUnavailableError';}
}
