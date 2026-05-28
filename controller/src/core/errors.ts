export class HttpStatus extends Error {
  public readonly status: number;
  public readonly detail: string;

  public constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}

export const isHttpStatus = (value: unknown): value is HttpStatus => value instanceof HttpStatus;

export const notFound = (detail: string): HttpStatus => new HttpStatus(404, detail);

export const badRequest = (detail: string): HttpStatus => new HttpStatus(400, detail);

export const serviceUnavailable = (detail: string): HttpStatus => new HttpStatus(503, detail);
