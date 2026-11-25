/* global Request, Response, Headers, AbortController, AbortSignal, ReadableStream, TextEncoder, TextDecoder */
// jsdom does not implement the Fetch API classes that React Router's data
// router uses for navigations. Node's versions are exposed together with
// Node's AbortController: a Request only accepts a signal from its own realm.
// FormData stays jsdom's own, because React builds it from jsdom form elements.
import { TestEnvironment } from 'jest-environment-jsdom';

export default class JsdomWithFetchEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context);
    Object.assign(this.global, {
      Request,
      Response,
      Headers,
      AbortController,
      AbortSignal,
      ReadableStream,
      TextEncoder,
      TextDecoder,
    });
  }
}
