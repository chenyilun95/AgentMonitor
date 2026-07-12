import { useState, useEffect } from 'react';
import { api, type Skill } from '../api/client';
import { useTranslation } from '../i18n';

const VALID_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export function Skills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');
  const [nameError, setNameError] = useState('');
  const { t } = useTranslation();

  const fetchSkills = async () => {
    try {
      const data = await api.getSkills();
      setSkills(data);
    } catch (err) {
      console.error('Failed to fetch skills:', err);
    }
  };

  useEffect(() => { fetchSkills(); }, []);

  const handleCreate = async () => {
    if (!name || !description) return;
    if (!VALID_NAME.test(name)) {
      setNameError(t('skills.nameValidation'));
      return;
    }
    try {
      await api.createSkill({ name, description, body });
      resetForm();
      fetchSkills();
    } catch (err) {
      setNameError(String(err));
    }
  };

  const handleUpdate = async () => {
    if (!editing) return;
    await api.updateSkill(editing, { description, body });
    resetForm();
    fetchSkills();
  };

  const handleDelete = async (skillName: string) => {
    await api.deleteSkill(skillName);
    fetchSkills();
  };

  const handleScriptUpload = async (skillName: string, file: File) => {
    await api.uploadSkillScript(skillName, file);
    fetchSkills();
  };

  const handleScriptDelete = async (skillName: string, filename: string) => {
    await api.deleteSkillScript(skillName, filename);
    fetchSkills();
  };

  const startEdit = (skill: Skill) => {
    setEditing(skill.name);
    setName(skill.name);
    setDescription(skill.description);
    setBody(skill.body);
    setCreating(false);
    setNameError('');
  };

  const startCreate = () => {
    setEditing(null);
    resetForm();
    setCreating(true);
  };

  const resetForm = () => {
    setEditing(null);
    setCreating(false);
    setName('');
    setDescription('');
    setBody('');
    setNameError('');
  };

  const isFormOpen = creating || editing !== null;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{t('skills.title')}</h1>
        {!isFormOpen && (
          <button className="btn" onClick={startCreate}>
            {t('skills.newSkill')}
          </button>
        )}
      </div>

      {isFormOpen && (
        <div style={{ marginBottom: 24 }}>
          <div className="form-group">
            <label>{t('skills.skillName')}</label>
            <input
              value={name}
              onChange={(e) => { setName(e.target.value); setNameError(''); }}
              placeholder={t('skills.skillNamePlaceholder')}
              disabled={editing !== null}
            />
            {nameError && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>{nameError}</div>}
          </div>
          <div className="form-group">
            <label>{t('skills.description')}</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('skills.descriptionPlaceholder')}
            />
          </div>
          <div className="form-group">
            <label>{t('skills.body')}</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t('skills.bodyPlaceholder')}
              style={{ minHeight: 200 }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={editing ? handleUpdate : handleCreate}>
              {editing ? t('common.update') : t('common.create')}
            </button>
            <button className="btn btn-outline" onClick={resetForm}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      <div className="skill-list">
        {skills.length === 0 && !isFormOpen ? (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
            {t('skills.empty')}
          </div>
        ) : (
          skills.map((skill) => (
            <div key={skill.name} className="skill-item">
              <div className="skill-item-info">
                <div className="skill-item-name">{skill.name}</div>
                <div className="skill-item-desc">{skill.description}</div>
                {skill.scripts.length > 0 && (
                  <div className="skill-scripts">
                    {skill.scripts.map((s) => (
                      <span key={s} className="script-badge">
                        {s}
                        <button onClick={() => handleScriptDelete(skill.name, s)} title={t('common.delete')}>&times;</button>
                      </span>
                    ))}
                  </div>
                )}
                <label style={{ display: 'inline-block', marginTop: 8, cursor: 'pointer', fontSize: 12, color: 'var(--primary)' }}>
                  {t('skills.uploadScript')}
                  <input
                    type="file"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleScriptUpload(skill.name, file);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
              <div className="skill-actions">
                <button className="btn btn-sm btn-outline" onClick={() => startEdit(skill)}>
                  {t('common.edit')}
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => handleDelete(skill.name)}>
                  {t('common.delete')}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
