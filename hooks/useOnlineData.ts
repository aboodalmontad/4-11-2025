import { getSupabaseClient } from '../supabaseClient';
import { Client, AdminTask, Appointment, AccountingEntry, Invoice, InvoiceItem, CaseDocument, Profile, SiteFinancialEntry, SyncDeletion } from '../types';
// Fix: Use `import type` for User as it is used as a type, not a value. This resolves module resolution errors in some environments.
import type { User } from '@supabase/supabase-js';

// This file defines the shape of data when flattened for sync operations.
export type FlatData = {
    clients: Omit<Client, 'cases'>[];
    cases: any[];
    stages: any[];
    sessions: any[];
    admin_tasks: AdminTask[];
    appointments: Appointment[];
    accounting_entries: AccountingEntry[];
    assistants: { name: string }[];
    invoices: Omit<Invoice, 'items'>[];
    invoice_items: InvoiceItem[];
    case_documents: CaseDocument[];
    profiles: Profile[];
    site_finances: SiteFinancialEntry[];
};


/**
 * Checks if the Supabase database is accessible and initialized.
 * Optimized to prevent "Failed to fetch" errors caused by too many concurrent requests.
 */
export const checkSupabaseSchema = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) {
        return { success: false, error: 'unconfigured', message: 'Supabase client is not configured.' };
    }

    try {
        // Optimization: Instead of checking ALL tables (which causes network congestion/Failed to fetch),
        // we check the most critical table: 'profiles'. If this exists and connects, the DB is generally online.
        const { error } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).limit(1);

        if (error) {
            const message = String(error.message || '').toLowerCase();
            const code = String(error.code || '');
            
            if (code === '42P01' || message.includes('does not exist') || message.includes('could not find the table')) {
                return { success: false, error: 'uninitialized', message: `Database uninitialized. Table 'profiles' missing.` };
            } else {
                // Propagate other errors (like auth or permission) as simple connection errors for now
                throw error;
            }
        }
        
        return { success: true, error: null, message: '' };

    } catch (err: any) {
        const message = String(err?.message || '').toLowerCase();
        const code = String(err?.code || '');

        if (message.includes('failed to fetch')) {
            return { success: false, error: 'network', message: 'Failed to connect to the server. Check internet connection.' };
        }
        
        if (message.includes('does not exist') || code === '42P01') {
            return { success: false, error: 'uninitialized', message: 'Database is not fully initialized.' };
        }

        return { success: false, error: 'unknown', message: `Database connection failed: ${err.message}` };
    }
};


/**
 * Fetches the entire dataset for the current user from Supabase.
 */
export const fetchDataFromSupabase = async (): Promise<Partial<FlatData>> => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client not available.');

    // We still fetch all data in parallel here, but this is usually handled better by the browser
    // than the pre-flight OPTIONS requests of the schema check.
    const [
        clientsRes, adminTasksRes, appointmentsRes, accountingEntriesRes,
        assistantsRes, invoicesRes, casesRes, stagesRes, sessionsRes, invoiceItemsRes,
        caseDocumentsRes, profilesRes, siteFinancesRes
    ] = await Promise.all([
        supabase.from('clients').select('*'),
        supabase.from('admin_tasks').select('*'),
        supabase.from('appointments').select('*'),
        supabase.from('accounting_entries').select('*'),
        supabase.from('assistants').select('name'),
        supabase.from('invoices').select('*'),
        supabase.from('cases').select('*'),
        supabase.from('stages').select('*'),
        supabase.from('sessions').select('*'),
        supabase.from('invoice_items').select('*'),
        supabase.from('case_documents').select('*'),
        supabase.from('profiles').select('*'),
        supabase.from('site_finances').select('*'),
    ]);

    const results = [
        { res: clientsRes, name: 'clients' },
        { res: adminTasksRes, name: 'admin_tasks' },
        { res: appointmentsRes, name: 'appointments' },
        { res: accountingEntriesRes, name: 'accounting_entries' },
        { res: assistantsRes, name: 'assistants' },
        { res: invoicesRes, name: 'invoices' },
        { res: casesRes, name: 'cases' },
        { res: stagesRes, name: 'stages' },
        { res: sessionsRes, name: 'sessions' },
        { res: invoiceItemsRes, name: 'invoice_items' },
        { res: caseDocumentsRes, name: 'case_documents' },
        { res: profilesRes, name: 'profiles' },
        { res: siteFinancesRes, name: 'site_finances' },
    ];

    for (const { res, name } of results) {
        if (res.error) {
            throw new Error(`Failed to fetch ${name}: ${res.error.message}`);
        }
    }

    return {
        clients: clientsRes.data || [],
        cases: casesRes.data || [],
        stages: stagesRes.data || [],
        sessions: sessionsRes.data || [],
        admin_tasks: adminTasksRes.data || [],
        appointments: appointmentsRes.data || [],
        accounting_entries: accountingEntriesRes.data || [],
        assistants: assistantsRes.data || [],
        invoices: invoicesRes.data || [],
        invoice_items: invoiceItemsRes.data || [],
        case_documents: caseDocumentsRes.data || [],
        profiles: profilesRes.data || [],
        site_finances: siteFinancesRes.data || [],
    };
};

/**
 * ADMIN ONLY: Fetches the entire database dump.
 */
export const fetchFullDatabaseBackup = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client not available.');

    // List of tables to backup
    const tables = [
        'profiles',
        'assistants',
        'clients',
        'cases',
        'stages',
        'sessions',
        'admin_tasks',
        'appointments',
        'accounting_entries',
        'invoices',
        'invoice_items',
        'case_documents',
        'site_finances',
        'sync_deletions'
    ];

    const backupData: Record<string, any[]> = {};

    for (const table of tables) {
        const { data, error } = await supabase.from(table).select('*');
        if (error) {
            throw new Error(`Failed to backup table ${table}: ${error.message}`);
        }
        backupData[table] = data || [];
    }

    return backupData;
};

/**
 * ADMIN ONLY: Restores a full database dump.
 * Uses upsert to avoid duplicate key errors, effectively updating existing records and inserting new ones.
 */
export const restoreFullDatabaseBackup = async (backupData: Record<string, any[]>) => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client not available.');

    // Order matters for Foreign Key constraints
    const tableOrder = [
        'profiles',
        'assistants',
        'clients',
        'cases',
        'stages',
        'sessions',
        'case_documents',
        'invoices',
        'invoice_items',
        'accounting_entries',
        'admin_tasks',
        'appointments',
        'site_finances',
        'sync_deletions'
    ];

    for (const table of tableOrder) {
        const records = backupData[table];
        if (records && Array.isArray(records) && records.length > 0) {
            // Process in chunks to avoid payload size limits
            const chunkSize = 100;
            for (let i = 0; i < records.length; i += chunkSize) {
                let chunk = records.slice(i, i + chunkSize);
                
                // For assistants table, we need to handle the conflict on (user_id, name)
                const options = table === 'assistants' ? { onConflict: 'user_id,name' } : undefined;
                
                if (table === 'assistants') {
                    // Remove ID to rely on unique constraint for matching/inserting, preventing ID collisions
                    chunk = chunk.map(({ id, ...rest }) => rest);
                }

                const { error } = await supabase.from(table).upsert(chunk, options);
                
                if (error) {
                    console.error(`Error restoring table ${table}:`, error);
                    throw new Error(`Failed to restore table ${table}: ${error.message}`);
                }
            }
        }
    }
};

/**
 * Cleanup expired cloud documents (older than 48 hours).
 * This deletes them from Storage and DB *without* logging to sync_deletions.
 * This effectively makes them "local only" on client devices that already have them.
 */
export const cleanupExpiredCloudDocuments = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    try {
        // 1. Find expired documents
        const { data: expiredDocs, error: findError } = await supabase
            .from('case_documents')
            .select('id, storage_path')
            .lt('added_at', fortyEightHoursAgo);

        if (findError) throw findError;
        if (!expiredDocs || expiredDocs.length === 0) return;

        console.log(`Found ${expiredDocs.length} expired documents to cleanup.`);

        // 2. Delete from Storage
        const pathsToDelete = expiredDocs.map(d => d.storage_path).filter(Boolean);
        if (pathsToDelete.length > 0) {
            const { error: storageError } = await supabase.storage.from('documents').remove(pathsToDelete);
            if (storageError) console.error("Error cleaning up storage files:", storageError);
        }

        // 3. Delete from Database (Directly, NO sync_deletions log)
        // We use a separate delete call here. Ideally this should bypass triggers if any log deletions,
        // but currently our sync_deletions logic is manual in `deleteDataFromSupabase`.
        // So a standard delete here works perfectly as "silent delete" from the sync perspective.
        const idsToDelete = expiredDocs.map(d => d.id);
        const { error: dbError } = await supabase
            .from('case_documents')
            .delete()
            .in('id', idsToDelete);

        if (dbError) throw dbError;

        console.log("Expired documents cleanup completed successfully.");

    } catch (err) {
        console.error("Failed to cleanup expired documents:", err);
    }
};

export const fetchDeletionsFromSupabase = async (): Promise<SyncDeletion[]> => {
    const supabase = getSupabaseClient();
    if (!supabase) return [];
    
    // Fetch deletions from the last 30 days to keep payload small but effective
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    try {
        const { data, error } = await supabase
            .from('sync_deletions')
            .select('*')
            .gte('deleted_at', thirtyDaysAgo.toISOString());

        if (error) {
            // Robust error stringification to avoid [object Object]
            const errorMsg = error.message || JSON.stringify(error) || 'Unknown Supabase error';
            throw new Error(errorMsg);
        }
        return data || [];
    } catch (err: any) {
        let msg = 'Unknown error fetching deletions';
        if (err instanceof Error) {
            msg = err.message;
        } else if (typeof err === 'object' && err !== null) {
            msg = (err as any).message || JSON.stringify(err);
        } else {
            msg = String(err);
        }
        console.error("Fetch deletions error:", msg);
        throw new Error(msg); 
    }
};

export const deleteDataFromSupabase = async (deletions: Partial<FlatData>, user: User) => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client not available.');

    const deletionOrder: (keyof FlatData)[] = [
        'case_documents', 'invoice_items', 'sessions', 'stages', 'cases', 'invoices', 
        'admin_tasks', 'appointments', 'accounting_entries', 'assistants', 'clients',
        'site_finances',
        'profiles',
    ];

    for (const table of deletionOrder) {
        const itemsToDelete = (deletions as any)[table];
        if (itemsToDelete && itemsToDelete.length > 0) {
            const primaryKeyColumn = table === 'assistants' ? 'name' : 'id';
            const ids = itemsToDelete.map((i: any) => i[primaryKeyColumn]);
            
            // 1. Log the deletion for sync resurrection prevention
            if (table !== 'profiles') {
                const deletionsLog = ids.map((id: string) => ({
                    table_name: table,
                    record_id: id,
                    user_id: user.id
                }));
                
                const { error: logError } = await supabase.from('sync_deletions').insert(deletionsLog).select();
                
                if (logError) {
                    console.warn("Could not log deletion (safe to ignore if DB not updated):", logError.message || JSON.stringify(logError));
                }
            }

            // 2. Perform the hard delete
            const { error } = await supabase.from(table).delete().in(primaryKeyColumn, ids);
            if (error) {
                console.error(`Error deleting from ${table}:`, error);
                const msg = error.message || JSON.stringify(error);
                const newError = new Error(msg);
                (newError as any).table = table;
                throw newError;
            }
        }
    }
};

export const upsertDataToSupabase = async (data: Partial<FlatData>, user: User) => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client not available.');

    // IMPORTANT: 'user' passed here might be a constructed object with 'effectiveUserId' as 'id'.
    // We use this ID to assign ownership of new records.
    const userId = user.id;

    // Filter out Local-Only documents before upserting
    const documentsToUpsert = data.case_documents?.filter(doc => !doc.isLocalOnly);

    // Map application data (camelCase) to database schema (snake_case)
    const dataToUpsert = {
        clients: data.clients?.map(({ contactInfo, ...rest }) => ({ ...rest, user_id: userId, contact_info: contactInfo })),
        cases: data.cases?.map(({ clientName, opponentName, feeAgreement, ...rest }) => ({ ...rest, user_id: userId, client_name: clientName, opponent_name: opponentName, fee_agreement: feeAgreement })),
        stages: data.stages?.map(({ caseNumber, firstSessionDate, decisionDate, decisionNumber, decisionSummary, decisionNotes, ...rest }) => ({ ...rest, user_id: userId, case_number: caseNumber, first_session_date: firstSessionDate, decision_date: decisionDate, decision_number: decisionNumber, decision_summary: decisionSummary, decision_notes: decisionNotes })),
        sessions: data.sessions?.map((s: any) => ({
            id: s.id,
            user_id: userId,
            stage_id: s.stage_id,
            court: s.court,
            case_number: s.case_number,
            date: s.date,
            client_name: s.client_name,
            opponent_name: s.opponent_name,
            postponement_reason: s.postponement_reason || s.postponement_reason, // Handle both cases
            next_postponement_reason: s.next_postponement_reason || s.next_postponement_reason,
            is_postponed: s.is_postponed,
            next_session_date: s.next_session_date,
            assignee: s.assignee,
            updated_at: s.updated_at
        })),
        admin_tasks: data.admin_tasks?.map(({ dueDate, orderIndex, ...rest }) => ({ ...rest, user_id: userId, due_date: dueDate, order_index: orderIndex })),
        appointments: data.appointments?.map(({ reminderTimeInMinutes, ...rest }) => ({ ...rest, user_id: userId, reminder_time_in_minutes: reminderTimeInMinutes })),
        accounting_entries: data.accounting_entries?.map(({ clientId, caseId, clientName, ...rest }) => ({ ...rest, user_id: userId, client_id: clientId, case_id: caseId, client_name: clientName })),
        assistants: data.assistants?.map(item => ({ ...item, user_id: userId })),
        invoices: data.invoices?.map(({ clientId, clientName, caseId, caseSubject, issueDate, dueDate, taxRate, ...rest }) => ({ ...rest, user_id: userId, client_id: clientId, client_name: clientName, case_id: caseId, case_subject: caseSubject, issue_date: issueDate, due_date: dueDate, tax_rate: taxRate })),
        invoice_items: data.invoice_items?.map(({ ...item }) => ({ ...item, user_id: userId })),
        case_documents: documentsToUpsert?.map(({ caseId, userId: localUserId, addedAt, storagePath, localState, isLocalOnly, ...rest }) => ({ ...rest, user_id: userId, case_id: caseId, added_at: addedAt, storage_path: storagePath })),
        profiles: data.profiles?.map(({ full_name, mobile_number, is_approved, is_active, subscription_start_date, subscription_end_date, lawyer_id, permissions, ...rest }) => ({ ...rest, full_name, mobile_number, is_approved, is_active, subscription_start_date, subscription_end_date, lawyer_id, permissions })),
        site_finances: data.site_finances?.map(({ user_id, payment_date, ...rest }) => ({ ...rest, user_id, payment_date })),
    };
    
    const upsertTable = async (table: string, records: any[] | undefined, options: { onConflict?: string } = {}) => {
        if (!records || records.length === 0) return [];
        const { data: responseData, error } = await supabase.from(table).upsert(records, options).select();
        if (error) {
            console.error(`Error upserting to ${table}:`, error);
            // Fix: properly extract error message to prevent [object Object]
            const errorDetails = error.message || JSON.stringify(error);
            const msg = `Error upserting to ${table}: ${errorDetails}`;
            const newError = new Error(msg);
            (newError as any).table = table;
            throw newError;
        }
        return responseData || [];
    };
    
    const results: Partial<Record<keyof FlatData, any[]>> = {};

    results.profiles = await upsertTable('profiles', dataToUpsert.profiles);
    results.assistants = await upsertTable('assistants', dataToUpsert.assistants, { onConflict: 'user_id,name' });
    
    // Core Hierarchy: Clients -> Cases -> Stages -> Sessions
    results.clients = await upsertTable('clients', dataToUpsert.clients);
    results.cases = await upsertTable('cases', dataToUpsert.cases);
    results.stages = await upsertTable('stages', dataToUpsert.stages);
    // Fix: Ensure session objects are mapped correctly before upserting to avoid missing fields if source structure slightly differs
    const mappedSessions = dataToUpsert.sessions?.map((s: any) => ({
         id: s.id,
         user_id: s.user_id,
         stage_id: s.stage_id,
         court: s.court,
         case_number: s.case_number,
         date: s.date,
         client_name: s.client_name,
         opponent_name: s.opponent_name,
         postponement_reason: s.postponement_reason, // Handle both cases
         next_postponement_reason: s.next_postponement_reason,
         is_postponed: s.is_postponed,
         next_session_date: s.next_session_date,
         assignee: s.assignee,
         updated_at: s.updated_at
    }));
    results.sessions = await upsertTable('sessions', mappedSessions);
    
    // Dependencies on Core
    results.invoices = await upsertTable('invoices', dataToUpsert.invoices);
    results.invoice_items = await upsertTable('invoice_items', dataToUpsert.invoice_items);
    results.case_documents = await upsertTable('case_documents', dataToUpsert.case_documents);
    
    // Miscellaneous (Accounting often links to Clients/Cases, so it should come after)
    const [adminTasks, appointments, accountingEntries, site_finances] = await Promise.all([
        upsertTable('admin_tasks', dataToUpsert.admin_tasks),
        upsertTable('appointments', dataToUpsert.appointments),
        upsertTable('accounting_entries', dataToUpsert.accounting_entries),
        upsertTable('site_finances', dataToUpsert.site_finances),
    ]);
    results.admin_tasks = adminTasks;
    results.appointments = appointments;
    results.accounting_entries = accountingEntries;
    results.site_finances = site_finances;
    
    return results;
};

// Helper to transform remote snake_case data to local camelCase format
export const transformRemoteToLocal = (remote: any): Partial<FlatData> => {
    if (!remote) return {};
    return {
        clients: remote.clients?.map(({ contact_info, ...r }: any) => ({ ...r, contactInfo: contact_info })),
        cases: remote.cases?.map(({ client_name, opponent_name, fee_agreement, ...r }: any) => ({ ...r, clientName: client_name, opponentName: opponent_name, feeAgreement: fee_agreement })),
        stages: remote.stages?.map(({ case_number, first_session_date, decision_date, decision_number, decision_summary, decision_notes, ...r }: any) => ({ ...r, caseNumber: case_number, firstSessionDate: first_session_date, decisionDate: decision_date, decisionNumber: decision_number, decisionSummary: decision_summary, decisionNotes: decision_notes })),
        sessions: remote.sessions?.map(({ case_number, client_name, opponent_name, postponement_reason, next_postponement_reason, is_postponed, next_session_date, ...r }: any) => ({ ...r, caseNumber: case_number, clientName: client_name, opponentName: opponent_name, postponementReason: postponement_reason, nextPostponementReason: next_postponement_reason, isPostponed: is_postponed, nextSessionDate: next_session_date })),
        admin_tasks: remote.admin_tasks?.map(({ due_date, order_index, ...r }: any) => ({ ...r, dueDate: due_date, orderIndex: order_index })),
        appointments: remote.appointments?.map(({ reminder_time_in_minutes, ...r }: any) => ({ ...r, reminderTimeInMinutes: reminder_time_in_minutes })),
        accounting_entries: remote.accounting_entries?.map(({ client_id, case_id, client_name, ...r }: any) => ({ ...r, clientId: client_id, caseId: case_id, clientName: client_name })),
        assistants: remote.assistants?.map((a: any) => ({ name: a.name })),
        invoices: remote.invoices?.map(({ client_id, client_name, case_id, case_subject, issue_date, due_date, tax_rate, ...r }: any) => ({ ...r, clientId: client_id, clientName: client_name, caseId: case_id, caseSubject: case_subject, issueDate: issue_date, dueDate: due_date, taxRate: tax_rate })),
        invoice_items: remote.invoice_items,
        case_documents: remote.case_documents?.map(({ user_id, case_id, added_at, storage_path, ...r }: any) => ({...r, userId: user_id, caseId: case_id, addedAt: added_at, storagePath: storage_path })),
        profiles: remote.profiles?.map(({ full_name, mobile_number, is_approved, is_active, subscription_start_date, subscription_end_date, lawyer_id, permissions, ...r }: any) => ({ ...r, full_name, mobile_number, is_approved, is_active, subscription_start_date, subscription_end_date, lawyer_id, permissions })),
        site_finances: remote.site_finances,
    };
};