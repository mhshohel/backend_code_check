import { schemaSDL } from './generated/schema-sdl';

/** The authoritative SDL from contracts/schema.graphql, embedded at codegen time. */
export function loadSchemaSDL(): string {
  return schemaSDL;
}

export { schemaSDL };
