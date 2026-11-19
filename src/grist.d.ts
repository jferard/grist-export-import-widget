// generated.

declare namespace grist {
    /** Return type of `grist.docApi.getAccessToken()` */
    export interface AccessTokenResult {
        token: string;
        baseUrl: string;
        ttlMsecs: number;
    }

    export interface AccessTokenOptions {
        readOnly?: boolean;
    }

    /** A single row returned by `onRecord` / `onRecords` */
    export interface RowRecord {
        id: number;
        [colId: string]: CellValue;
    }

    /** Column-oriented table format returned by `docApi.fetchTable()` */
    export interface TableData {
        id: number[];
        [colId: string]: CellValue[];
    }

    /** Column-oriented table format */
    export interface TableDataWithoutId {
        [colId: string]: CellValue[];
    }

    export type CellValue =
        | number
        | string
        | boolean
        | null
        | undefined
        | [string, ...unknown[]];

    export type AccessLevel = "none" | "read table" | "full";

    export interface ColumnSpec {
        name: string;
        title?: string;
        optional?: boolean;
        type?: string;
        description?: string;
        allowMultiple?: boolean;
        strictType?: boolean;
    }

    export interface ReadyOptions {
        requiredAccess?: AccessLevel;
        columns?: Array<string | ColumnSpec>;
        allowSelectBy?: boolean;
        onEditOptions?: () => void;
    }

    export interface InteractionOptions {
        accessLevel: AccessLevel;
        hasCustomOptions?: boolean;
    }

    export type WidgetOptions = Record<string, unknown>;

    export type UserAction = [string, ...unknown[]];

    export interface ApplyUserActionsResult {
        actionNum: number;
        actionHash: string;
        retValues: unknown[];
        isModification: boolean;
    }

    export interface CursorPos {
        rowId?: number | "new";
        fieldIndex?: number;
        colId?: string;
        sectionId?: number;
    }

    export interface TableOperations {
        create(
            records:
                | { fields: Record<string, CellValue> }
                | Array<{ fields: Record<string, CellValue> }>
        ): Promise<{ id: number } | Array<{ id: number }>>;
        update(
            records:
                | { id: number; fields: Record<string, CellValue> }
                | Array<{ id: number; fields: Record<string, CellValue> }>
        ): Promise<void>;
        destroy(rowIds: number | number[]): Promise<void>;
        upsert(
            records:
                | { require: Record<string, CellValue>; fields?: Record<string, CellValue> }
                | Array<{ require: Record<string, CellValue>; fields?: Record<string, CellValue> }>,
            options?: { onMany?: "first" | "none" | "all"; allowEmptyRequire?: boolean }
        ): Promise<void>;
    }

    export interface GristDocAPI {
        listTables(): Promise<string[]>;
        fetchTable(tableId: string): Promise<TableData>;
        applyUserActions(
            actions: UserAction[],
            options?: { desc?: string; otherId?: number; linkId?: number }
        ): Promise<ApplyUserActionsResult>;
        getAccessToken(options?: AccessTokenOptions): Promise<AccessTokenResult>;
    }

    export interface WidgetAPI {
        getOption(key: string): Promise<unknown>;
        setOption(key: string, value: unknown): Promise<void>;
        getOptions(): Promise<WidgetOptions | null>;
        setOptions(options: WidgetOptions): Promise<void>;
        clearOptions(): Promise<void>;
    }

    export interface ViewAPI {
        fetchSelectedTable(options?: {
            keepEncoded?: boolean;
            format?: "rows" | "columns";
        }): Promise<TableData>;
        fetchSelectedRecord(
            rowId: number,
            options?: { keepEncoded?: boolean }
        ): Promise<RowRecord>;
        allowSelectBy(): Promise<void>;
        setSelectedRows(rowIds: number[] | null): Promise<void>;
        setCursorPos(pos: CursorPos): Promise<void>;
    }
}

declare const grist: {
    ready(options?: grist.ReadyOptions): void;
    onRecord(
        callback: (
            record: grist.RowRecord | null,
            mappings?: Record<string, string | string[] | null>
        ) => void
    ): void;
    onRecords(
        callback: (
            records: grist.RowRecord[],
            mappings?: Record<string, string | string[] | null>
        ) => void
    ): void;
    onNewRecord(callback: () => void): void;
    onOptions(
        callback: (
            options: grist.WidgetOptions | null,
            interaction?: grist.InteractionOptions
        ) => void
    ): void;

    // Shortcut option & selection methods
    getOption(key: string): Promise<unknown>;
    setOption(key: string, value: unknown): Promise<void>;
    getOptions(): Promise<grist.WidgetOptions | null>;
    setOptions(options: grist.WidgetOptions): Promise<void>;
    clearOptions(): Promise<void>;
    setSelectedRows(rowIds: number[] | null): Promise<void>;
    setCursorPos(pos: grist.CursorPos): Promise<void>;

    // Column mapping helper
    mapColumnNames<T = Record<string, grist.CellValue>>(
        source: grist.RowRecord | grist.RowRecord[],
        options?: {
            columns?: Array<string | grist.ColumnSpec>;
            mappings?: Record<string, string | string[] | null>;
            reverse?: boolean;
        }
    ): T;
    mapColumnNamesBack(
        source: unknown,
        options?: {
            columns?: Array<string | grist.ColumnSpec>;
            mappings?: Record<string, string | string[] | null>;
        }
    ): unknown;

    // Table & Sub-APIs
    getTable(tableId?: string): grist.TableOperations;
    selectedTable: grist.TableOperations;
    docApi: grist.GristDocAPI;
    widgetApi: grist.WidgetAPI;
    viewApi: grist.ViewAPI;
};