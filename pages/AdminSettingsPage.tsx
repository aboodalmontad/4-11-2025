
import * as React from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { MusicalNoteIcon, PlayCircleIcon, TrashIcon, ArrowUpTrayIcon, ServerIcon, CloudArrowDownIcon, ArrowDownTrayIcon, ExclamationTriangleIcon, CheckCircleIcon } from '../components/icons';
import { defaultUserApprovalSoundBase64 } from '../components/RealtimeNotifier';
import { fetchFullDatabaseBackup, restoreFullDatabaseBackup } from '../hooks/useOnlineData';

const USER_APPROVAL_SOUND_KEY = 'customUserApprovalSound';

interface AdminSettingsPageProps {
    onOpenConfig: () => void;
}

const AdminSettingsPage: React.FC<AdminSettingsPageProps> = ({ onOpenConfig }) => {
    const [customSound, setCustomSound] = useLocalStorage<string | null>(USER_APPROVAL_SOUND_KEY, null);
    const [feedback, setFeedback] = React.useState<{ message: string; type: 'success' | 'error' | 'loading' } | null>(null);
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    const showFeedback = (message: string, type: 'success' | 'error' | 'loading') => {
        setFeedback({ message, type });
        if (type !== 'loading') {
            setTimeout(() => setFeedback(null), 5000);
        }
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        if (!file.type.startsWith('audio/')) {
            showFeedback('الرجاء اختيار ملف صوتي صالح.', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const base64 = e.target?.result as string;
            setCustomSound(base64);
            showFeedback('تم حفظ صوت التنبيه الجديد بنجاح.', 'success');
        };
        reader.onerror = () => {
            showFeedback('فشل في قراءة الملف.', 'error');
        };
        reader.readAsDataURL(file);
    };

    const playSound = () => {
        const soundSource = customSound || defaultUserApprovalSoundBase64;
        
        if (!soundSource) {
             showFeedback('الملف الصوتي المعتمد للتنبيه غير موجود. الرجاء اختيار نغمة جديدة.', 'error');
             return;
        }

        try {
            // Create a new Audio object on demand for robust preview playback.
            const audio = new Audio(soundSource);
            audio.play().catch(e => {
                console.error("Audio preview playback failed:", e);
                // Specific feedback based on the playback error
                showFeedback('فشل تشغيل الملف الصوتي. قد يكون الملف تالفاً أو غير مدعوم. الرجاء اختيار نغمة تنبيه جديدة.', 'error');
            });
        } catch (e) {
            console.error("Error creating Audio object for preview:", e);
            showFeedback('حدث خطأ في تهيئة الصوت. الرجاء إعادة تحميل الصفحة أو اختيار نغمة جديدة.', 'error');
        }
    };

    const resetSound = () => {
        setCustomSound(null);
        showFeedback('تمت استعادة الصوت الافتراضي.', 'success');
    };

    // --- Backup & Restore Logic ---

    const handleDownloadBackup = async () => {
        showFeedback('جاري تحضير النسخة الاحتياطية... يرجى الانتظار.', 'loading');
        try {
            const data = await fetchFullDatabaseBackup();
            const jsonString = JSON.stringify(data, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `lawyer_system_full_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showFeedback('تم تنزيل النسخة الاحتياطية بنجاح.', 'success');
        } catch (error: any) {
            console.error("Backup failed:", error);
            showFeedback(`فشل عملية النسخ الاحتياطي: ${error.message}`, 'error');
        }
    };

    const handleRestoreClick = () => {
        if (window.confirm("تحذير: استعادة قاعدة البيانات ستقوم بتحديث السجلات الموجودة وإضافة سجلات جديدة من الملف. يفضل أخذ نسخة احتياطية حالية قبل المتابعة. هل أنت متأكد؟")) {
            fileInputRef.current?.click();
        }
    };

    const handleRestoreFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        showFeedback('جاري استعادة البيانات... يرجى عدم إغلاق الصفحة.', 'loading');
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const text = e.target?.result;
                if (typeof text !== 'string') throw new Error("Could not read file");
                const backupData = JSON.parse(text);
                
                await restoreFullDatabaseBackup(backupData);
                showFeedback('تم استعادة قاعدة البيانات بنجاح! يرجى تحديث الصفحة.', 'success');
            } catch (error: any) {
                console.error("Restore failed:", error);
                showFeedback(`فشل عملية الاستعادة: ${error.message}`, 'error');
            }
            // Reset input
            if (fileInputRef.current) fileInputRef.current.value = '';
        };
        reader.readAsText(file);
    };

    return (
        <div className="space-y-8">
            <h1 className="text-3xl font-bold text-gray-800">إعدادات المدير</h1>

            {feedback && (
                <div className={`p-4 rounded-lg flex items-center gap-3 ${feedback.type === 'success' ? 'bg-green-100 text-green-800' : feedback.type === 'error' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'}`}>
                    {feedback.type === 'success' && <CheckCircleIcon className="w-5 h-5" />}
                    {feedback.type === 'error' && <ExclamationTriangleIcon className="w-5 h-5" />}
                    {feedback.type === 'loading' && <ServerIcon className="w-5 h-5 animate-pulse" />}
                    <span>{feedback.message}</span>
                </div>
            )}
            
            <div className="bg-white p-6 rounded-lg shadow space-y-6">
                <h2 className="text-xl font-bold text-gray-800 border-b pb-3 flex items-center gap-3">
                    <CloudArrowDownIcon className="w-6 h-6 text-blue-600" />
                    <span>إدارة النسخ الاحتياطي للنظام (قاعدة البيانات)</span>
                </h2>
                <div className="p-4 bg-gray-50 border rounded-lg space-y-4">
                    <p className="text-sm text-gray-600">
                        يمكنك هنا تنزيل نسخة كاملة من قاعدة البيانات (تشمل جميع المستخدمين، القضايا، الموكلين، والبيانات المالية) وحفظها كملف JSON. كما يمكنك استعادة النظام من نسخة سابقة.
                    </p>
                    <div className="bg-yellow-50 border-r-4 border-yellow-400 p-3 rounded">
                        <p className="text-xs text-yellow-800">
                            <strong>تنبيه:</strong> عملية الاستعادة (Restore) تقوم بدمج وتحديث البيانات. لن يتم حذف البيانات التي أضيفت بعد تاريخ النسخة الاحتياطية، ولكن سيتم الكتابة فوق السجلات المتطابقة. لا تشمل النسخة الاحتياطية ملفات الوثائق (الصور/PDF) المخزنة، بل تشمل بياناتها الوصفية فقط.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-4 mt-4">
                        <button 
                            onClick={handleDownloadBackup}
                            className="flex items-center gap-2 px-4 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
                        >
                            <ArrowDownTrayIcon className="w-5 h-5" />
                            <span>تحميل نسخة كاملة (Backup)</span>
                        </button>
                        
                        <input 
                            type="file" 
                            ref={fileInputRef} 
                            onChange={handleRestoreFileChange} 
                            className="hidden" 
                            accept=".json"
                        />
                        <button 
                            onClick={handleRestoreClick}
                            className="flex items-center gap-2 px-4 py-3 bg-white border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
                        >
                            <ArrowUpTrayIcon className="w-5 h-5" />
                            <span>استعادة نسخة (Restore)</span>
                        </button>
                    </div>
                </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow space-y-6">
                <h2 className="text-xl font-bold text-gray-800 border-b pb-3 flex items-center gap-3">
                    <ServerIcon className="w-6 h-6 text-blue-600" />
                    <span>تكوين النظام</span>
                </h2>
                <div className="p-4 bg-gray-50 border rounded-lg">
                    <h3 className="font-semibold text-lg text-gray-800">معالج إعداد قاعدة البيانات</h3>
                    <p className="text-sm text-gray-600 mt-1">
                        استخدم هذه الأداة لإعداد جداول قاعدة البيانات، وتكوين صلاحيات التخزين، وإصلاح مشاكل المزامنة. يجب استخدام هذه الأداة بحذر.
                    </p>
                    <div className="mt-4">
                        <button 
                            onClick={onOpenConfig}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors"
                        >
                            <ServerIcon className="w-5 h-5" />
                            <span>فتح معالج الإعداد</span>
                        </button>
                    </div>
                </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow space-y-6">
                <h2 className="text-xl font-bold text-gray-800 border-b pb-3 flex items-center gap-3">
                    <MusicalNoteIcon className="w-6 h-6 text-blue-600" />
                    <span>تخصيص صوت التنبيهات</span>
                </h2>

                <div className="p-4 bg-gray-50 border rounded-lg">
                    <h3 className="font-semibold text-lg text-gray-800">صوت تنبيه تسجيل مستخدم جديد</h3>
                    <p className="text-sm text-gray-600 mt-1">
                        اختر ملفًا صوتيًا (مثل MP3, WAV) ليتم تشغيله عند تسجيل مستخدم جديد في انتظار الموافقة.
                    </p>

                    <div className="mt-4 flex flex-col sm:flex-row items-center gap-4">
                        <input
                            type="file"
                            id="sound-upload"
                            accept="audio/*"
                            className="hidden"
                            onChange={handleFileChange}
                        />
                        <label
                            htmlFor="sound-upload"
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors cursor-pointer"
                        >
                            <ArrowUpTrayIcon className="w-5 h-5" />
                            <span>اختر ملفًا صوتيًا...</span>
                        </label>

                        
                        <button
                            onClick={playSound}
                            className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600 transition-colors"
                        >
                            <PlayCircleIcon className="w-5 h-5" />
                            <span>تشغيل الصوت الحالي</span>
                        </button>
                        {customSound && (
                            <button
                                onClick={resetSound}
                                className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white font-semibold rounded-lg hover:bg-red-600 transition-colors"
                            >
                                <TrashIcon className="w-5 h-5" />
                                <span>استعادة الافتراضي</span>
                            </button>
                        )}
                    </div>
                     {customSound ? <p className="text-xs text-gray-500 mt-2">تم تعيين صوت مخصص.</p> : <p className="text-xs text-gray-500 mt-2">يتم استخدام الصوت الافتراضي حالياً.</p>}
                </div>
            </div>
        </div>
    );
};

export default AdminSettingsPage;
