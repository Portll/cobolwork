// The part of JSON Schema 2020-12 cobolwork's schemas use, checked without a dependency. Returns one
// string per place a value departs from its schema; an empty list means it conforms. `load` reads
// another schema in schema/ by file name, for a $ref such as "cobolwork-finding.schema.json".
const TYPES = {
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  array: Array.isArray,
  string: (v) => typeof v === 'string',
  integer: Number.isInteger,
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  boolean: (v) => typeof v === 'boolean',
  null: (v) => v === null,
};
const SUPPORTED = new Set(['$schema', '$id', '$ref', '$defs', 'title', 'description', 'type', 'properties', 'required',
  'additionalProperties', 'patternProperties', 'items', 'enum', 'const', 'minimum', 'maximum', 'minLength', 'pattern',
  'anyOf', 'oneOf', 'minItems', 'uniqueItems', 'format', 'examples', 'default', 'deprecated']);

export function schemaProblems(value, schema, root = schema, at = '$', load = null) {
  if (schema === true || schema === undefined) return [];
  if (schema === false) return [`${at}: is not allowed`];
  const unknown = Object.keys(schema).filter((k) => !SUPPORTED.has(k));
  if (unknown.length) throw new Error(`${at}: the schema uses ${unknown.join(', ')}, which schema-check does not read`);
  if (schema.$ref) {
    const m = /^([a-z.-]+\.schema\.json)?(?:#\/\$defs\/(.+))?$/.exec(schema.$ref);
    const other = m?.[1] ? load?.(m[1]) : root;
    const target = m && other && (m[2] ? other.$defs?.[m[2]] : m[1] ? other : null);
    if (!target) throw new Error(`${at}: cannot resolve ${schema.$ref}`);
    return schemaProblems(value, target, other, at, load);
  }
  const out = [];
  if (schema.type) {
    const types = [].concat(schema.type);
    if (!types.some((t) => TYPES[t](value))) return [`${at}: is ${JSON.stringify(value)?.slice(0, 60)}, not ${types.join(' or ')}`];
  }
  if ('const' in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) out.push(`${at}: is not ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) out.push(`${at}: ${JSON.stringify(value)?.slice(0, 60)} is not one of ${schema.enum.join(', ')}`);
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) out.push(`${at}: ${value} is below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) out.push(`${at}: ${value} is above ${schema.maximum}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) out.push(`${at}: is shorter than ${schema.minLength}`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) out.push(`${at}: does not match ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) out.push(`${at}: has fewer than ${schema.minItems} items`);
    if (schema.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) out.push(`${at}: repeats an item`);
    if (schema.items !== undefined) value.forEach((v, i) => out.push(...schemaProblems(v, schema.items, root, `${at}[${i}]`, load)));
  }
  if (TYPES.object(value)) {
    for (const k of schema.required || []) if (!(k in value)) out.push(`${at}: lacks ${k}`);
    const patterns = Object.entries(schema.patternProperties || {}).map(([p, s]) => [new RegExp(p, 'u'), s]);
    for (const [k, v] of Object.entries(value)) {
      const where = `${at}.${k}`;
      if (schema.properties && k in schema.properties) { out.push(...schemaProblems(v, schema.properties[k], root, where, load)); continue; }
      const matched = patterns.filter(([re]) => re.test(k));
      if (matched.length) { for (const [, s] of matched) out.push(...schemaProblems(v, s, root, where, load)); continue; }
      if (schema.additionalProperties !== undefined) out.push(...schemaProblems(v, schema.additionalProperties, root, where, load));
    }
  }
  for (const [key, need] of [['anyOf', (n) => n >= 1], ['oneOf', (n) => n === 1]]) {
    if (!schema[key]) continue;
    const passing = schema[key].filter((s) => !schemaProblems(value, s, root, at, load).length).length;
    if (!need(passing)) out.push(`${at}: matches ${passing} of the ${key} schemas`);
  }
  return out;
}

// The keywords anywhere in a schema that schemaProblems does not read.
export function unreadKeywords(schema, at = '$') {
  if (!schema || typeof schema !== 'object') return [];
  const out = Object.keys(schema).filter((k) => !SUPPORTED.has(k)).map((k) => `${at}.${k}`);
  for (const k of ['properties', 'patternProperties', '$defs']) {
    for (const [name, s] of Object.entries(schema[k] || {})) out.push(...unreadKeywords(s, `${at}.${k}.${name}`));
  }
  for (const k of ['additionalProperties', 'items']) if (typeof schema[k] === 'object') out.push(...unreadKeywords(schema[k], `${at}.${k}`));
  for (const k of ['anyOf', 'oneOf']) (schema[k] || []).forEach((s, i) => out.push(...unreadKeywords(s, `${at}.${k}[${i}]`)));
  return out;
}
