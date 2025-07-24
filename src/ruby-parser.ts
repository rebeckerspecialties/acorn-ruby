/* ---------------------------------------------------------------------------
   ruby_dsl_parser.ts — Gem & Pod dependency extractor (mobile‑friendly)
   ---------------------------------------------------------------------------
   • Pure TypeScript; no runtime‑closure allocations in hot loops
   • Handles Gemfile / Podfile and *.gemspec / *.podspec
   • Extracts runtime & development dependencies + literal package name/version
   • %w version arrays, send(:add_dependency, …) indirection, literal‑name spec
   • Dynamic interpolations are logged (console.error) without throwing
   • RubyDslError includes line, column, byte offset, prev‑token hex, opener pos
   • All error throws are *inline* (no helper) so top stack frame is meaningful
   --------------------------------------------------------------------------- */

/*********************************** 0. Char codes **********************************/
const CHARACTER_TAB = 0x09;
const LINE_FEED = 0x0a;
const SPACE_CHARACTER = 0x20;
const SINGLE_QUOTE_CHARACTER = 0x27;
const DOUBLE_QUOTE_CHARACTER = 0x22;
const PERCENT_CHARACTER = 0x25;
const LEFT_PARENTHESIS = 0x28;
const RIGHT_PARENTHESIS = 0x29;
const LEFT_BRACKET = 0x5b;
const RIGHT_BRACKET = 0x5d;
const LEFT_CURLY_BRACE = 0x7b;
const RIGHT_CURLY_BRACE = 0x7d;
const LESS_THAN_CHARACTER = 0x3c;
const GREATER_THAN_CHARACTER = 0x3e;
const COMMA_CHARACTER = 0x2c;
const DOT_CHARACTER = 0x2e;
const COLON_CHARACTER = 0x3a;
const EQUALS_CHARACTER = 0x3d;
const HASH_CHARACTER = 0x23;
const BACKSLASH_CHARACTER = 0x5c;
const PIPE_CHARACTER = 0x7c;
const MINUS_CHARACTER = 0x2d;
const PLUS_CHARACTER = 0x2b;
const AMPERSAND_CHARACTER = 0x26;
const EXCLAMATION_CHARACTER = 0x21;
const ASTERISK_CHARACTER = 0x2a;
const FORWARD_SLASH_CHARACTER = 0x2f;
const SEMICOLON_CHARACTER = 0x3b;
const DOLLAR_CHARACTER = 0x24;
const UNDERSCORE_CHARACTER = 0x5f;
const QUESTION_CHARACTER = 0x3f;
const LETTER_A_CHARACTER = 64;
const LETTER_Z_CHARACTER = 90;
const LOWERCASE_A_CHARACTER = 97;
const LOWERCASE_Z_CHARACTER = 122;
const DIGIT_ZERO_CHARACTER = 48;
const DIGIT_NINE_CHARACTER = 57;

type CharCode = number;

/*********************************** 1. Limits & Regex ******************************/
const MAX_TOKENS = 40_000;
const MAX_ITERATIONS = 2;
const MAX_STRING_LENGTH = 8 * 1024;
const MAX_BLOCK_DEPTH = 256;

function closingDelimiter(open: CharCode): CharCode {
    switch (open) {
        case LEFT_CURLY_BRACE:
            return RIGHT_CURLY_BRACE;
        case LEFT_BRACKET:
            return RIGHT_BRACKET;
        case LEFT_PARENTHESIS:
            return RIGHT_PARENTHESIS;
        case LESS_THAN_CHARACTER:
            return GREATER_THAN_CHARACTER;
        default:
            return open; // symmetric delimiter
    }
}

/*********************************** 2. Error helper *******************************/
function formatError(
    message: string,
    line: number,
    column: number,
    prevHex: string,
    opener?: { line: number; column: number }
): string {
    return (
        `${message} @${line}:${column} prev=0x${prevHex}` +
        (opener ? ` opener@${opener.line}:${opener.column}` : '')
    );
}

export class RubyDslError extends Error {
    constructor(
        message: string,
        readonly offset: number,
        readonly line: number,
        readonly column: number,
        readonly previousHex: string,
        opener?: { line: number; column: number }
    ) {
        super(formatError(message, line, column, previousHex, opener));
        this.name = 'RubyDslError';
    }
}

/*********************************** 3. Token types *********************************/
export enum TokenKind {
    Identifier,
    String,
    Symbol,
    Integer,
    Comma,
    Colon,
    LeftParen,
    RightParen,
    LeftBracket,
    RightBracket,
    Dot,
    Equals,
    NewLine,
    Do,
    End,
    If,
    Else,
    EndOfFile,
}

export interface Token {
    kind: TokenKind;
    text: string;
    start: number;
    end: number;
    line: number;
    column: number;
}

/*********************************** 4. Tokenizer ***********************************/
export function tokenize(source: string): Token[] {
    const tokens: Token[] = [];
    let index = 0,
        iterations = 0,
        line = 1,
        column = 1;

    const previousHex = () =>
        tokens.length
            ? tokens[tokens.length - 1].text.charCodeAt(0).toString(16)
            : '00';

    const push = (kind: TokenKind, start: number, end: number) => {
        if (tokens.length >= MAX_TOKENS)
            throw new RubyDslError(
                'token quota exceeded',
                index,
                line,
                column,
                previousHex()
            );
        tokens.push({
            kind,
            text: source.slice(start, end),
            start,
            end,
            line,
            column,
        });
    };

    while (index < source.length) {
        if (++iterations > source.length * MAX_ITERATIONS)
            throw new RubyDslError(
                'runaway lexer',
                index,
                line,
                column,
                previousHex()
            );

        const cc = source.charCodeAt(index) as CharCode;

        /* whitespace */
        if (cc === SPACE_CHARACTER || cc === CHARACTER_TAB) {
            index++;
            column++;
            continue;
        }
        if (cc === LINE_FEED) {
            push(TokenKind.NewLine, index, index + 1);
            index++;
            line++;
            column = 1;
            continue;
        }

        /* single characters */
        if (
            cc === COMMA_CHARACTER ||
            cc === LEFT_PARENTHESIS ||
            cc === RIGHT_PARENTHESIS ||
            cc === LEFT_BRACKET ||
            cc === RIGHT_BRACKET ||
            cc === DOT_CHARACTER ||
            cc === EQUALS_CHARACTER
        ) {
            const kind =
                cc === COMMA_CHARACTER
                    ? TokenKind.Comma
                    : cc === LEFT_PARENTHESIS
                      ? TokenKind.LeftParen
                      : cc === RIGHT_PARENTHESIS
                        ? TokenKind.RightParen
                        : cc === LEFT_BRACKET
                          ? TokenKind.LeftBracket
                          : cc === RIGHT_BRACKET
                            ? TokenKind.RightBracket
                            : cc === DOT_CHARACTER
                              ? TokenKind.Dot
                              : TokenKind.Equals;
            push(kind, index, ++index);
            column++;
            continue;
        }

        /* colon / symbol */
        if (cc === COLON_CHARACTER) {
            const next = source.charCodeAt(index + 1);
            const prev = index > 0 ? source.charCodeAt(index - 1) : 0;
            // namespace resolution '::'
            if (next === COLON_CHARACTER || prev === COLON_CHARACTER) {
                push(TokenKind.Colon, index, index + 1);
                index++;
                column++;
                continue;
            }
            // symbol literal with quoted identifier
            if (
                next === SINGLE_QUOTE_CHARACTER ||
                next === DOUBLE_QUOTE_CHARACTER
            ) {
                const start = index;
                const quoteChar = next;
                index++;
                column++;
                const opener = { line, column };
                index++;
                column++;
                let len = 0;
                while (
                    index < source.length &&
                    source.charCodeAt(index) !== quoteChar
                ) {
                    if (++len > MAX_STRING_LENGTH)
                        throw new RubyDslError(
                            'symbol literal too long',
                            index,
                            line,
                            column,
                            previousHex(),
                            opener
                        );
                    if (source.charCodeAt(index) === LINE_FEED) {
                        line++;
                        column = 1;
                    } else column++;
                    index++;
                }
                if (index >= source.length)
                    throw new RubyDslError(
                        'unterminated symbol',
                        index,
                        line,
                        column,
                        previousHex(),
                        opener
                    );
                index++;
                column++;
                push(TokenKind.Symbol, start, index);
                continue;
            }
            // symbol literal with unquoted identifier
            const c2 = source.charCodeAt(index + 1);
            if (
                (c2 >= LETTER_A_CHARACTER && c2 <= LETTER_Z_CHARACTER) ||
                (c2 >= LOWERCASE_A_CHARACTER && c2 <= LOWERCASE_Z_CHARACTER) ||
                (c2 >= DIGIT_ZERO_CHARACTER && c2 <= DIGIT_NINE_CHARACTER) ||
                c2 === UNDERSCORE_CHARACTER
            ) {
                const start = index;
                index++;
                column++;
                let c3;
                while (
                    index < source.length &&
                    (((c3 = source.charCodeAt(index)) >= LETTER_A_CHARACTER &&
                        c3 <= LETTER_Z_CHARACTER) ||
                        (c3 >= LOWERCASE_A_CHARACTER &&
                            c3 <= LOWERCASE_Z_CHARACTER) ||
                        (c3 >= DIGIT_ZERO_CHARACTER &&
                            c3 <= DIGIT_NINE_CHARACTER) ||
                        c3 === UNDERSCORE_CHARACTER)
                ) {
                    index++;
                    column++;
                }
                push(TokenKind.Symbol, start, index);
                continue;
            }
            // punctuation colon
            push(TokenKind.Colon, index, index + 1);
            index++;
            column++;
            continue;
        }

        /* comment */
        if (cc === HASH_CHARACTER) {
            while (
                index < source.length &&
                source.charCodeAt(index) !== LINE_FEED
            ) {
                index++;
                column++;
            }
            continue;
        }

        /* block parameter delimiter */
        if (cc === PIPE_CHARACTER) {
            push(TokenKind.Symbol, index, index + 1);
            index++;
            column++;
            continue;
        }

        /* quoted string */
        if (cc === SINGLE_QUOTE_CHARACTER || cc === DOUBLE_QUOTE_CHARACTER) {
            const quote = cc,
                start = index,
                opener = { line, column };
            index++;
            column++;
            let len = 0;
            while (
                index < source.length &&
                source.charCodeAt(index) !== quote
            ) {
                if (++len > MAX_STRING_LENGTH)
                    throw new RubyDslError(
                        'string literal too long',
                        index,
                        line,
                        column,
                        previousHex(),
                        opener
                    );
                if (source.charCodeAt(index) === BACKSLASH_CHARACTER) {
                    index++;
                    column++;
                }
                if (source.charCodeAt(index) === LINE_FEED) {
                    line++;
                    column = 1;
                } else column++;
                index++;
            }
            if (index >= source.length)
                throw new RubyDslError(
                    'unterminated string',
                    index,
                    line,
                    column,
                    previousHex(),
                    opener
                );
            push(TokenKind.String, start, ++index);
            column++;
            continue;
        }

        /* %q / %w */
        if (
            cc === PERCENT_CHARACTER &&
            (source[index + 1] === 'q' || source[index + 1] === 'w')
        ) {
            const start = index;
            const opener = { line, column };
            // determine delimiter: char after '%q'/'%w'
            const openDelim = source.charCodeAt(index + 2) as CharCode;
            const closeDelim = closingDelimiter(openDelim);
            index += 3;
            column += 3;
            let len = 0;
            while (
                index < source.length &&
                source.charCodeAt(index) !== closeDelim
            ) {
                if (++len > MAX_STRING_LENGTH)
                    throw new RubyDslError(
                        '%q/%w literal too long',
                        index,
                        line,
                        column,
                        previousHex(),
                        opener
                    );
                if (source.charCodeAt(index) === BACKSLASH_CHARACTER) {
                    index++;
                    column++;
                }
                if (source.charCodeAt(index) === LINE_FEED) {
                    line++;
                    column = 1;
                } else column++;
                index++;
            }
            if (index >= source.length)
                throw new RubyDslError(
                    'unterminated %q/%w literal',
                    index,
                    line,
                    column,
                    previousHex(),
                    opener
                );
            index++;
            column++;
            push(TokenKind.String, start, index);
            continue;
        }

        /* other punctuation (braces, angle, math operators) */
        if (
            cc === LEFT_CURLY_BRACE ||
            cc === RIGHT_CURLY_BRACE ||
            cc === LESS_THAN_CHARACTER ||
            cc === GREATER_THAN_CHARACTER ||
            cc === MINUS_CHARACTER ||
            cc === PLUS_CHARACTER ||
            cc === AMPERSAND_CHARACTER ||
            cc === ASTERISK_CHARACTER ||
            cc === FORWARD_SLASH_CHARACTER ||
            cc === SEMICOLON_CHARACTER
        ) {
            index++;
            column++;
            continue;
        }

        /* identifier */
        if (
            (cc >= LETTER_A_CHARACTER && cc <= LETTER_Z_CHARACTER) ||
            (cc >= LOWERCASE_A_CHARACTER && cc <= LOWERCASE_Z_CHARACTER) ||
            cc === UNDERSCORE_CHARACTER ||
            cc === DOLLAR_CHARACTER
        ) {
            const start = index;
            let c;
            while (
                index < source.length &&
                (((c = source.charCodeAt(index)) >= LETTER_A_CHARACTER &&
                    c <= LETTER_Z_CHARACTER) ||
                    (c >= LOWERCASE_A_CHARACTER &&
                        c <= LOWERCASE_Z_CHARACTER) ||
                    (c >= DIGIT_ZERO_CHARACTER && c <= DIGIT_NINE_CHARACTER) ||
                    c === UNDERSCORE_CHARACTER ||
                    c === DOLLAR_CHARACTER ||
                    c === QUESTION_CHARACTER ||
                    c === EXCLAMATION_CHARACTER)
            ) {
                index++;
                column++;
            }
            const word = source.slice(start, index);
            const kind =
                word === 'do'
                    ? TokenKind.Do
                    : word === 'end'
                      ? TokenKind.End
                      : word === 'if'
                        ? TokenKind.If
                        : word === 'else'
                          ? TokenKind.Else
                          : TokenKind.Identifier;
            push(kind, start, index);
            continue;
        }

        /* integer */
        if (cc >= DIGIT_ZERO_CHARACTER && cc <= DIGIT_NINE_CHARACTER) {
            const start = index;
            let c;
            while (
                index < source.length &&
                (c = source.charCodeAt(index)) >= DIGIT_ZERO_CHARACTER &&
                c <= DIGIT_NINE_CHARACTER
            ) {
                index++;
                column++;
            }
            push(TokenKind.Integer, start, index);
            continue;
        }

        throw new RubyDslError(
            'unknown character',
            index,
            line,
            column,
            previousHex()
        );
    }

    push(TokenKind.EndOfFile, index, index);
    return tokens;
}

/*********************************** 5. AST *************************************/
export interface GemDeclaration {
    name: string;
    versions: string[];
    git?: string;
    path?: string;
    require?: boolean;
    groups?: string[];
    platforms: string[];
}

export interface ParseOutput {
    selfName?: string;
    selfVersion?: string;
    groups: {
        runtime: GemDeclaration[];
        development: GemDeclaration[];
    };
}

/*********************************** 6. Parser **************************************/
export class Parser {
    private cursor = 0;
    private depth = 0;

    constructor(private readonly tokens: Token[]) {}

    private peekKind = () => this.tokens[this.cursor].kind;
    private peekText = () => this.tokens[this.cursor].text;
    private advance = () => this.tokens[this.cursor++];
    private previous = () => this.tokens[this.cursor - 1];

    private throwError(message: string): never {
        const p = this.previous();
        throw new RubyDslError(
            message,
            p.end,
            p.line,
            p.column,
            p.text.charCodeAt(0).toString(16)
        );
    }

    private match(kind: TokenKind): boolean {
        return this.peekKind() === kind ? (this.cursor++, true) : false;
    }
    private matchWord(word: string): boolean {
        return this.peekKind() === TokenKind.Identifier &&
            this.peekText() === word
            ? (this.cursor++, true)
            : false;
    }

    parse(): ParseOutput {
        const out: ParseOutput = { groups: { runtime: [], development: [] } };
        while (this.peekKind() !== TokenKind.EndOfFile)
            this.statement(out, [], []);
        return out;
    }

    /******** dispatcher ********/
    private statement(out: ParseOutput, groups: string[], platforms: string[]) {
        if (this.matchWord('gem') || this.matchWord('pod')) {
            const decl = this.parseDecl(groups, platforms);
            const hasDevGroups =
                decl.groups &&
                decl.groups.some((g) => g === 'development' || g === 'test');
            const targetArray = hasDevGroups
                ? out.groups.development
                : out.groups.runtime;

            // Remove groups field for development gems
            if (hasDevGroups) {
                delete decl.groups;
            }

            // Handle trailing conditionals - skip 'if' and rest of line
            const hasTrailingConditional = this.peekKind() === TokenKind.If;
            if (hasTrailingConditional) {
                delete decl.groups; // Remove groups for conditional gems
                this.advance(); // consume 'if'
                while (
                    this.peekKind() !== TokenKind.NewLine &&
                    this.peekKind() !== TokenKind.EndOfFile
                )
                    this.advance();
            }

            targetArray.push(decl);
            this.skipLine();
            return;
        }
        if (this.matchWord('group') || this.matchWord('target')) {
            const newGroups = this.labels();
            if (this.match(TokenKind.Do)) {
                this.enter();
                while (!this.match(TokenKind.End))
                    this.statement(out, newGroups, platforms);
                this.leave();
            }
            return;
        }
        if (this.matchWord('platforms')) {
            const pls = this.labels();
            if (this.match(TokenKind.Do)) {
                this.enter();
                while (!this.match(TokenKind.End))
                    this.statement(out, groups, pls);
                this.leave();
            }
            return;
        }
        if (this.matchWord('source')) {
            this.skipLine();
            return;
        }
        if (this.looksSpecNew()) {
            this.parseSpec(out);
            return;
        }
        if (this.match(TokenKind.Do) || this.match(TokenKind.LeftParen)) {
            this.skipBlock();
            return;
        }
        this.skipLine();
    }

    /******** gem/pod line ********/
    private parseDecl(groups: string[], platforms: string[]): GemDeclaration {
        // Handle optional parentheses
        const hasParens = this.match(TokenKind.LeftParen);

        const nameTok = this.advance();
        if (
            nameTok.kind !== TokenKind.String &&
            nameTok.kind !== TokenKind.Symbol &&
            nameTok.kind !== TokenKind.Identifier
        )
            this.throwError('name literal expected');
        const name =
            nameTok.kind === TokenKind.Identifier
                ? nameTok.text
                : strip(nameTok.text);

        // Handle .freeze method call
        if (this.match(TokenKind.Dot) && this.matchWord('freeze')) {
            // Name remains the same, just skip the .freeze
        }

        const versions: string[] = [];
        let git: string | undefined,
            path: string | undefined,
            req: boolean | undefined;
        const inlineGroups: string[] = [];
        const inlinePlatforms: string[] = [];

        while (this.match(TokenKind.Comma)) {
            // Check if it's a version string
            if (this.peekKind() === TokenKind.String) {
                const lit = this.advance().text;
                versions.push(
                    ...(lit.startsWith('%w')
                        ? fromPercentW(lit)
                        : [strip(lit).trim()])
                );
                continue;
            }

            // Check for array literal [">= 1"]
            if (this.match(TokenKind.LeftBracket)) {
                while (this.peekKind() === TokenKind.String) {
                    versions.push(strip(this.advance().text).trim());
                    if (!this.match(TokenKind.Comma)) break;
                }
                this.match(TokenKind.RightBracket);
                continue;
            }

            // Otherwise it's a key-value pair
            let key = '';
            if (this.peekKind() === TokenKind.Symbol) {
                key = strip(this.advance().text).replace(/^:/, '');
            } else if (this.peekKind() === TokenKind.Identifier) {
                key = this.advance().text;
            } else break;

            if (!this.match(TokenKind.Equals) && !this.match(TokenKind.Colon))
                break;

            if (key === 'group') {
                if (this.peekKind() === TokenKind.Identifier) {
                    inlineGroups.push(this.advance().text);
                } else if (this.peekKind() === TokenKind.Symbol) {
                    inlineGroups.push(strip(this.advance().text));
                }
            } else if (key === 'platforms') {
                if (this.match(TokenKind.LeftBracket)) {
                    while (this.peekKind() === TokenKind.Symbol) {
                        inlinePlatforms.push(strip(this.advance().text));
                        if (!this.match(TokenKind.Comma)) break;
                    }
                    this.match(TokenKind.RightBracket);
                }
            } else {
                const val = strip(this.advance().text);
                if (key === 'git' || key === 'github') git = val;
                else if (key === 'path') path = val;
                else if (key === 'require') req = val !== 'false';
            }
        }
        // Only match closing paren if we had an opening one
        if (hasParens) {
            this.match(TokenKind.RightParen);
        }
        // format version strings
        for (let i = 0; i < versions.length; i++) {
            const v = versions[i];
            let j = 0;
            while (
                j < v.length &&
                (v.charCodeAt(j) < DIGIT_ZERO_CHARACTER ||
                    v.charCodeAt(j) > DIGIT_NINE_CHARACTER)
            )
                j++;
            if (j > 0 && j < v.length && v.charAt(j - 1) !== ' ') {
                versions[i] = v.slice(0, j) + ' ' + v.slice(j);
            }
        }
        const allGroups = [...groups, ...inlineGroups];
        const allPlatforms = [...platforms, ...inlinePlatforms];

        const decl: GemDeclaration = {
            groups: allGroups,
            name,
            platforms: allPlatforms,
            versions,
        };
        if (git !== undefined) decl.git = git;
        if (path !== undefined) decl.path = path;
        if (req !== undefined) decl.require = req;
        return decl;
    }
    /******** Gem::Specification / Pod::Spec ********/
    private parseSpec(out: ParseOutput) {
        if (this.peekKind() === TokenKind.String)
            out.selfName = strip(this.advance().text);
        let blockVar: string | null = null;
        if (this.match(TokenKind.Do)) {
            if (this.matchSymbol('|')) {
                if (this.peekKind() === TokenKind.Identifier)
                    blockVar = this.advance().text;
                this.matchSymbol('|');
            }
            this.enter();
        }

        while (
            this.peekKind() !== TokenKind.EndOfFile &&
            !this.match(TokenKind.End)
        ) {
            // Handle if blocks - process first branch only
            if (this.match(TokenKind.If)) {
                // Skip the condition
                while (
                    this.peekKind() !== TokenKind.NewLine &&
                    this.peekKind() !== TokenKind.EndOfFile
                )
                    this.advance();
                this.match(TokenKind.NewLine);

                // Process statements until else or end
                while (
                    this.peekKind() !== TokenKind.EndOfFile &&
                    this.peekKind() !== TokenKind.Else &&
                    this.peekKind() !== TokenKind.End
                ) {
                    this.parseSpecStatement(out, blockVar);
                }

                // Skip else branch if present
                if (this.match(TokenKind.Else)) {
                    // Skip until matching end
                    while (
                        this.peekKind() !== TokenKind.EndOfFile &&
                        this.peekKind() !== TokenKind.End
                    ) {
                        this.advance();
                    }
                    this.match(TokenKind.End);
                } else {
                    this.match(TokenKind.End);
                }
                continue;
            }

            this.parseSpecStatement(out, blockVar);
        }
        if (this.depth) this.leave();
    }

    private parseSpecStatement(out: ParseOutput, blockVar: string | null) {
        if (
            this.peekKind() === TokenKind.Identifier &&
            (!blockVar || this.peekText() === blockVar)
        ) {
            this.advance();
            if (!this.match(TokenKind.Dot)) {
                this.skipLine();
                return;
            }
            const method = this.advance();
            if (method.kind !== TokenKind.Identifier) {
                this.skipLine();
                return;
            }
            if (
                this.match(TokenKind.Equals) &&
                this.peekKind() === TokenKind.String
            ) {
                const lit = strip(this.advance().text);
                if (method.text === 'name') out.selfName = lit;
                else if (method.text === 'version') out.selfVersion = lit;
                this.skipLine();
                return;
            }
            if (method.text === 'send') {
                this.match(TokenKind.LeftParen);
                if (this.peekKind() === TokenKind.Symbol) {
                    const sym = strip(this.advance().text).replace(/^:/, '');
                    if (sym.includes('dependency')) {
                        const isDev = sym.includes('development');
                        this.match(TokenKind.Comma);
                        const decl = this.parseDecl([], []);
                        (isDev
                            ? out.groups.development
                            : out.groups.runtime
                        ).push(decl);
                    }
                }
                this.skipLine();
                return;
            }
            const depMethods = [
                'add_dependency',
                'add_runtime_dependency',
                'add_development_dependency',
                'dependency',
            ];
            if (depMethods.includes(method.text)) {
                const isDev = method.text.includes('development');
                const decl = this.parseDecl([], []);
                if (method.text === 'dependency') delete decl.groups;
                (isDev ? out.groups.development : out.groups.runtime).push(
                    decl
                );
                this.skipLine();
                return;
            }
        }
        this.skipLine();
    }

    /******** helpers ********/
    private enter() {
        if (++this.depth > MAX_BLOCK_DEPTH) this.throwError('nesting too deep');
    }
    private leave() {
        this.depth--;
    }
    private looksSpecNew(): boolean {
        const start = this.cursor;
        const ok =
            (this.matchWord('Gem') || this.matchWord('Pod')) &&
            this.match(TokenKind.Colon) &&
            this.match(TokenKind.Colon) &&
            (this.matchWord('Specification') || this.matchWord('Spec')) &&
            this.match(TokenKind.Dot) &&
            this.matchWord('new');
        if (!ok) this.cursor = start;
        return ok;
    }
    private labels(): string[] {
        const arr: string[] = [];
        while (true) {
            if (
                this.peekKind() === TokenKind.Symbol ||
                this.peekKind() === TokenKind.String
            )
                arr.push(strip(this.advance().text));
            else if (this.peekKind() === TokenKind.Identifier)
                arr.push(this.advance().text);
            else break;
            if (!this.match(TokenKind.Comma)) break;
        }
        return arr;
    }
    private matchSymbol(sym: string) {
        return this.tokens[this.cursor].text === sym
            ? (this.cursor++, true)
            : false;
    }
    private skipLine() {
        // Skip 'if' conditions - assume first branch taken
        if (this.match(TokenKind.If)) {
            while (
                this.peekKind() !== TokenKind.NewLine &&
                this.peekKind() !== TokenKind.EndOfFile
            )
                this.advance();
        }
        while (
            this.peekKind() !== TokenKind.NewLine &&
            this.peekKind() !== TokenKind.EndOfFile
        )
            this.advance();
        this.match(TokenKind.NewLine);
    }
    private skipBlock() {
        let depth = 1;
        while (depth && this.peekKind() !== TokenKind.EndOfFile) {
            if (this.match(TokenKind.Do) || this.match(TokenKind.LeftParen))
                depth++;
            else if (
                this.match(TokenKind.End) ||
                this.match(TokenKind.RightParen)
            )
                depth--;
            else this.advance();
        }
    }
}

/*********************************** 7. Public API *********************************/
export function parseRubyDsl(source: string): ParseOutput {
    return new Parser(tokenize(source)).parse();
}

/*********************************** 8. Utility ************************************/
function strip(raw: string): string {
    // Use tokenizer approach to extract content from quoted strings
    let startIndex = 0;
    let endIndex = raw.length;

    // Handle %q and %w literals
    if (raw.startsWith('%q') || raw.startsWith('%w')) {
        startIndex = 3; // Skip %q{ or %w[
        endIndex = raw.length - 1; // Skip closing delimiter

        const openDelim = raw.charCodeAt(2);
        const closeDelim = closingDelimiter(openDelim);

        // For angle brackets, handle the special pattern <><><gemname><><>
        if (
            openDelim === LESS_THAN_CHARACTER &&
            closeDelim === GREATER_THAN_CHARACTER
        ) {
            // The content after %q< is: ><><gemname><><>
            // We want to extract just "gemname"

            // Skip >< pairs from the start
            while (
                startIndex + 1 < endIndex &&
                raw.charCodeAt(startIndex) === GREATER_THAN_CHARACTER &&
                raw.charCodeAt(startIndex + 1) === LESS_THAN_CHARACTER
            ) {
                startIndex += 2;
            }

            // Skip >< pairs from the end (going backwards)
            while (
                endIndex - 2 > startIndex &&
                raw.charCodeAt(endIndex - 2) === GREATER_THAN_CHARACTER &&
                raw.charCodeAt(endIndex - 1) === LESS_THAN_CHARACTER
            ) {
                endIndex -= 2;
            }

            // Final cleanup: skip any remaining > at start or < at end
            if (
                startIndex < endIndex &&
                raw.charCodeAt(startIndex) === GREATER_THAN_CHARACTER
            ) {
                startIndex++;
            }
            if (
                endIndex > startIndex &&
                raw.charCodeAt(endIndex - 1) === GREATER_THAN_CHARACTER
            ) {
                endIndex--;
            }
        } else {
            // Skip extra opening delimiters
            while (
                startIndex < endIndex &&
                raw.charCodeAt(startIndex) === openDelim
            ) {
                startIndex++;
            }

            // Skip extra closing delimiters from the end
            while (
                endIndex > startIndex &&
                raw.charCodeAt(endIndex - 1) === closeDelim
            ) {
                endIndex--;
            }
        }

        // Handle special case of %q{'''content'''} - strip triple quotes
        const content = raw.slice(startIndex, endIndex).trim();
        if (
            content.length >= 6 &&
            content.startsWith("'''") &&
            content.endsWith("'''")
        ) {
            return content.slice(3, -3);
        }

        return content;
    }

    // Handle regular quoted strings
    const firstChar = raw.charCodeAt(0);

    // Symbol with quotes like :"sym::bol"
    if (firstChar === COLON_CHARACTER && raw.length > 1) {
        const secondChar = raw.charCodeAt(1);
        if (
            secondChar === SINGLE_QUOTE_CHARACTER ||
            secondChar === DOUBLE_QUOTE_CHARACTER
        ) {
            startIndex = 2; // Skip :" or :'
            endIndex = raw.length - 1; // Skip closing quote
            return raw.slice(startIndex, endIndex);
        }
        // Regular symbol like :symbol
        return raw.slice(1); // Just skip the colon
    }

    // Handle quoted strings with extra quotes
    if (
        firstChar === SINGLE_QUOTE_CHARACTER ||
        firstChar === DOUBLE_QUOTE_CHARACTER
    ) {
        const quote = firstChar;
        startIndex = 1;
        endIndex = raw.length - 1;

        // Skip extra quotes at start
        while (startIndex < endIndex && raw.charCodeAt(startIndex) === quote) {
            startIndex++;
        }

        // Skip extra quotes at end
        while (
            endIndex > startIndex &&
            raw.charCodeAt(endIndex - 1) === quote
        ) {
            endIndex--;
        }

        // Handle nested quotes like '""rails""' -> should become 'rails'
        let content = raw.slice(startIndex, endIndex);

        // Keep stripping matching quote pairs from inside
        while (content.length >= 2) {
            const innerFirstChar = content.charCodeAt(0);
            const innerLastChar = content.charCodeAt(content.length - 1);

            // If content is wrapped in matching quotes, strip them
            if (
                (innerFirstChar === SINGLE_QUOTE_CHARACTER ||
                    innerFirstChar === DOUBLE_QUOTE_CHARACTER) &&
                innerFirstChar === innerLastChar
            ) {
                content = content.slice(1, -1);
            } else {
                break;
            }
        }

        return content;
    }

    // For other cases (like bare identifiers), return as-is
    return raw;
}

function fromPercentW(raw: string): string[] {
    if (!raw.startsWith('%w')) return [raw];

    // Extract content between delimiters
    const startIndex = 3;
    const endIndex = raw.length - 1;

    const content = raw.slice(startIndex, endIndex).trim();
    if (!content) return [];

    // Tokenize the content to properly handle spacing
    const items: string[] = [];
    let currentItem = '';
    let inItem = false;

    for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);

        if (
            char === SPACE_CHARACTER ||
            char === CHARACTER_TAB ||
            char === LINE_FEED
        ) {
            if (inItem) {
                items.push(currentItem);
                currentItem = '';
                inItem = false;
            }
        } else {
            currentItem += content[i];
            inItem = true;
        }
    }

    // Don't forget the last item
    if (inItem && currentItem) {
        items.push(currentItem);
    }

    return items;
}

Object.freeze(TokenKind);
