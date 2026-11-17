import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Camera, GraduationCap, Save, Trash2, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { errorMessage } from "../lib/errors";
import { AVATARS_BUCKET } from "../lib/files";
import { forgetAvatar } from "../lib/avatars";
import { Avatar, Card, Field, SectionTitle, Spinner } from "./ui";

const AVATAR_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const AVATAR_MAX = 2 * 1024 * 1024;

/** Üniversite, bölüm, teknik yetkinlikler ve profil fotoğrafı (kendi profilini düzenler). */
export default function ProfileDetails() {
  const { profile, refreshProfile } = useAuth();
  const toast = useToast();
  const p = profile!;
  const [university, setUniversity] = useState(p.university ?? "");
  const [major, setMajor] = useState(p.major ?? "");
  const [skills, setSkills] = useState<string[]>(p.skills ?? []);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"save" | "photo" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function persist(avatarPath: string | null, list = skills) {
    const { error } = await supabase.rpc("update_own_profile_details", {
      p_university: university, p_major: major, p_skills: list, p_avatar_path: avatarPath,
    });
    if (error) throw error;
    await refreshProfile();
  }

  function addSkill() {
    const s = draft.trim().replace(/,$/, "").slice(0, 40);
    if (!s) return;
    if (skills.length >= 30) return toast.warning("En fazla 30 yetkinlik eklenebilir.");
    if (!skills.some((x) => x.toLocaleLowerCase("tr-TR") === s.toLocaleLowerCase("tr-TR"))) setSkills([...skills, s]);
    setDraft("");
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addSkill(); }
    else if (e.key === "Backspace" && !draft && skills.length) setSkills(skills.slice(0, -1));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy("save");
    try {
      const pending = draft.trim() ? [...skills, draft.trim().slice(0, 40)] : skills;
      setDraft(""); setSkills(pending);
      await persist(p.avatar_path, pending);
      toast.success("Profil bilgileriniz güncellendi.");
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(null); }
  }

  async function uploadPhoto(file: File | undefined) {
    if (!file) return;
    const ext = AVATAR_TYPES[file.type];
    if (!ext) return toast.error("Profil fotoğrafı PNG, JPG veya WEBP olmalıdır.");
    if (file.size > AVATAR_MAX) return toast.error("Profil fotoğrafı en fazla 2 MB olabilir.");
    setBusy("photo");
    const path = `${p.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(AVATARS_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (error) { setBusy(null); return toast.error(errorMessage(error)); }
    const old = p.avatar_path;
    try {
      await persist(path);
      if (old) { forgetAvatar(old); await supabase.storage.from(AVATARS_BUCKET).remove([old]); }
      toast.success("Profil fotoğrafı güncellendi.");
    } catch (err) {
      await supabase.storage.from(AVATARS_BUCKET).remove([path]);
      toast.error(errorMessage(err));
    } finally { setBusy(null); }
  }

  async function removePhoto() {
    if (!p.avatar_path) return;
    setBusy("photo");
    const old = p.avatar_path;
    try {
      await persist(null);
      forgetAvatar(old);
      await supabase.storage.from(AVATARS_BUCKET).remove([old]);
      toast.success("Profil fotoğrafı kaldırıldı.");
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(null); }
  }

  return (
    <Card className="p-5">
      <SectionTitle><span className="flex items-center gap-2"><GraduationCap className="size-4 text-muted" /> Ekip profili</span></SectionTitle>
      <div className="mb-5 flex items-center gap-4">
        <Avatar person={p} size={72} />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
            {busy === "photo" ? <Spinner className="size-4" /> : <Camera className="size-4" />} Fotoğraf yükle
          </button>
          {p.avatar_path && <button type="button" className="btn-ghost" onClick={() => void removePhoto()} disabled={busy !== null}><Trash2 className="size-4" /> Kaldır</button>}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" data-testid="avatar-input"
            onChange={(e) => { void uploadPhoto(e.target.files?.[0]); e.target.value = ""; }} />
          <p className="w-full text-xs text-muted">PNG, JPG veya WEBP · en fazla 2 MB · yalnızca ekip üyeleri görür.</p>
        </div>
      </div>
      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Üniversite"><input className="input" name="university" value={university} maxLength={120} onChange={(e) => setUniversity(e.target.value)} placeholder="Örn. Gazi Üniversitesi" /></Field>
          <Field label="Bölüm"><input className="input" name="major" value={major} maxLength={120} onChange={(e) => setMajor(e.target.value)} placeholder="Örn. Uçak Mühendisliği" /></Field>
        </div>
        <div>
          <span className="label">Teknik yetkinlikler</span>
          <div className="input flex min-h-11 flex-wrap items-center gap-1.5 py-1.5">
            {skills.map((s) => (
              <span key={s} className="inline-flex items-center gap-1 rounded-md bg-accent/15 py-0.5 pr-1 pl-2 text-xs text-accent-2">
                {s}<button type="button" onClick={() => setSkills(skills.filter((x) => x !== s))} className="rounded p-0.5 hover:bg-ink/10" aria-label={`${s} yetkinliğini kaldır`}><X className="size-3" /></button>
              </span>
            ))}
            <input className="min-w-32 flex-1 bg-transparent text-sm outline-none placeholder:text-faint" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={addSkill}
              placeholder={skills.length ? "" : "SolidWorks, ANSYS, STM32, KiCad… (Enter ile ekleyin)"} aria-label="Yetkinlik ekle" />
          </div>
          <span className="mt-1 block text-xs text-muted">Ekip aramasında yetkinliğe göre bulunursunuz.</span>
        </div>
        <div className="flex justify-end">
          <button className="btn-primary" disabled={busy !== null}>{busy === "save" ? <Spinner className="size-4 text-current" /> : <Save className="size-4" />} Ekip profilini kaydet</button>
        </div>
      </form>
    </Card>
  );
}
