import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, downloadFile } from '../api'
import { useAuth } from '../auth'
import { useToast } from '../toast'
import { usePageBanner } from '../banner'

const AVATAR_COLORS = [
  ['#f59e0b', '#fb923c'], ['#7ba05b', '#a3be78'],
  ['#fb923c', '#fbbf24'], ['#f43f5e', '#fb7185'],
]

function ThesisBannerBridge() {
  usePageBanner({
    title: <span>论文<span className="hl">往返批改</span>档案</span>,
    subtitle: '每一轮提交与批注，都被妥善收进档案册',
  })
  return null
}

/* 阶段标签配色：按关键词给徽章换色 */
function stageClass(stage = '') {
  if (/完成|答辩|通过|归档/.test(stage)) return 'b4'
  if (/滞后|修改|退回|催/.test(stage)) return 'b3'
  if (/初稿|中期|查重|送审/.test(stage)) return 'b2'
  return ''
}

/* 后端 backend/app/models.py 的 STAGES。
   库里存在「修改」这类不在 STAGES 里的历史值，选项要把当前值兜住，否则一打开就丢。 */
const STAGES = ['开题', '初稿', '中期', '查重', '送审', '答辩', '完成']
const stageOptions = (cur) => (cur && !STAGES.includes(cur) ? [...STAGES, cur] : STAGES)
const MAX_FILE_BYTES = 20 * 1024 * 1024

const fmt = (t) => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '—')

export default function Thesis() {
  const { user } = useAuth()
  const toast = useToast()
  const isTeacher = user.role === 'teacher'

  const [projects, setProjects] = useState([])
  const [students, setStudents] = useState([])
  const [curId, setCurId] = useState(null)
  const [rounds, setRounds] = useState([])
  const [loadingRounds, setLoadingRounds] = useState(false)

  // 批注表单
  const [replyText, setReplyText] = useState('')
  const [replyFile, setReplyFile] = useState(null)
  const [sending, setSending] = useState(false)

  // 轮次视图：'latest' 只看当前（最新）一轮 / 'all' 看全部 / 数字看指定轮
  const [roundView, setRoundView] = useState('latest')

  // 弹层：create（建项目） / submit（学生提交新一轮）
  const [pop, setPop] = useState(null)
  const [newStudent, setNewStudent] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [submitText, setSubmitText] = useState('')
  const [submitFile, setSubmitFile] = useState(null)
  // 修改已建项目（论文题目 / 当前阶段）
  const [projTitle, setProjTitle] = useState('')
  const [projStage, setProjStage] = useState('开题')
  const [keepFile, setKeepFile] = useState(true)   // 修改提交时是否保留原附件
  const fileRef = useRef(null)

  const loadProjects = useCallback(async () => {
    try {
      const list = await api.get('/thesis/projects')
      /* 后端 /thesis/projects 对师生都返回「全班」项目（进度看板需要按年级铺开），
         所以学生端必须自己筛出属于本人的那一条：
         直接用 list[0] 会把排在前面的同学（如杨磊）的档案当成自己的，
         接着点「提交」就会因为 project.student_id ≠ user.id 被后端 403。 */
      const mine = isTeacher ? list : list.filter((p) => p.student_id === user.id)
      setProjects(mine)
      // 当前选中项：保留仍然存在的旧选择，否则动态落到列表第一项
      setCurId((id) => (id && mine.some((p) => p.id === id) ? id : mine[0]?.id ?? null))
      if (isTeacher) {
        const [stu] = await Promise.all([api.get('/users?role=student')])
        setStudents(stu)
      }
    } catch (e) { toast(e.message, 'error') }
  }, [isTeacher, toast, user.id])

  useEffect(() => { loadProjects() }, [loadProjects])

  /* 从进度看板弹窗点「论文往返记录」跳过来时带着 ?studentId=..
     数据加载完后自动把左侧索引定位到该学生（找不到就保持默认） */
  const [searchParams] = useSearchParams()
  const sidParam = searchParams.get('studentId')
  useEffect(() => {
    if (!sidParam) return
    const hit = projects.find((p) => String(p.student_id) === sidParam)
    if (hit) { setCurId(hit.id); setRoundView('latest') }
  }, [sidParam, projects])

  const sorted = useMemo(() => [...projects].sort((a, b) => {
    const g = String(b.grade_name || '').localeCompare(String(a.grade_name || ''), 'zh')
    if (g !== 0) return g
    return String(a.student_no || '').localeCompare(String(b.student_no || ''))
  }), [projects])

  const curIndex = sorted.findIndex((p) => p.id === curId)
  const cur = curIndex >= 0 ? sorted[curIndex] : null
  const ac = AVATAR_COLORS[(curIndex < 0 ? 0 : curIndex) % AVATAR_COLORS.length]

  const loadRounds = useCallback(async (pid) => {
    if (!pid) { setRounds([]); return }
    setLoadingRounds(true)
    try {
      setRounds(await api.get(`/thesis/projects/${pid}/rounds`))
    } catch (e) { toast(e.message, 'error') } finally { setLoadingRounds(false) }
  }, [toast])

  useEffect(() => { loadRounds(curId) }, [curId, loadRounds])

  /* ESC 关闭弹层 */
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setPop(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const orderedRounds = useMemo(() => [...rounds].sort((a, b) => b.round_no - a.round_no), [rounds])

  /* 默认只显示当前（最新）一轮；可切换指定轮次或查看全部 */
  const shownRounds = useMemo(() => {
    if (roundView === 'all') return orderedRounds
    const target = roundView === 'latest'
      ? Math.max(0, ...rounds.map((r) => r.round_no))
      : roundView
    return orderedRounds.filter((r) => r.round_no === target)
  }, [orderedRounds, roundView, rounds])
  const latest = rounds.length ? rounds[rounds.length - 1] : null
  const pendingLatest = latest && !latest.teacher_comment && !latest.teacher_file
  const doneCount = rounds.filter((r) => r.teacher_comment || r.teacher_file).length
  const canStudentSubmit = !pendingLatest // 上一轮未批注则禁止提交下一轮

  /* ---------- 老师：批注提交 ---------- */
  const sendReply = async (e) => {
    const btn = e.currentTarget
    const b = btn.getBoundingClientRect()
    const size = Math.max(b.width, b.height)
    const rip = document.createElement('span')
    rip.className = 'ripple'
    rip.style.cssText = `width:${size}px;height:${size}px;left:${(e.clientX || b.left + b.width / 2) - b.left - size / 2}px;top:${(e.clientY || b.top + b.height / 2) - b.top - size / 2}px`
    btn.appendChild(rip)
    setTimeout(() => rip.remove(), 700)

    if (!replyText.trim() && !replyFile) return toast('先写点批注意见再提交哦', 'error')
    if (replyFile?.size > MAX_FILE_BYTES) return toast('单个附件不能超过 20 MB', 'error')
    setSending(true)
    try {
      const fd = new FormData()
      fd.append('comment', replyText)
      if (replyFile) fd.append('file', replyFile)
      await api.postForm(`/thesis/rounds/${latest.id}/feedback`, fd)
      setReplyText('')
      setReplyFile(null)
      if (fileRef.current) fileRef.current.value = ''
      toast(`第 ${latest.round_no} 轮批注已提交并同步给 ${cur.student_name} ✓`, 'success')
      loadRounds(curId)
      loadProjects()
    } catch (err) { toast(err.message, 'error') } finally { setSending(false) }
  }

  /* ---------- 学生：提交新一轮 ---------- */
  const submitRound = async () => {
    if (!submitText.trim() && !submitFile) return toast('请填写说明或上传附件', 'error')
    if (submitFile?.size > MAX_FILE_BYTES) return toast('单个附件不能超过 20 MB', 'error')
    setSending(true)
    try {
      const fd = new FormData()
      fd.append('text', submitText)
      if (submitFile) fd.append('file', submitFile)
      await api.postForm(`/thesis/projects/${curId}/rounds`, fd)
      setPop(null)
      setSubmitText('')
      setSubmitFile(null)
      toast(`第 ${rounds.length + 1} 轮已提交 ✓`, 'success')
      loadRounds(curId)
      loadProjects()
    } catch (e) { toast(e.message, 'error') } finally { setSending(false) }
  }

  /* ---------- 学生：修改本次提交（老师批注前） ---------- */
  const openEditSubmit = () => {
    setSubmitText(latest?.student_text || '')
    setSubmitFile(null)
    setKeepFile(true)
    setPop('edit')
  }

  const saveEditSubmit = async () => {
    if (!submitText.trim() && !submitFile && !(keepFile && latest?.student_file)) {
      return toast('请填写说明或上传附件', 'error')
    }
    if (submitFile?.size > MAX_FILE_BYTES) return toast('单个附件不能超过 20 MB', 'error')
    setSending(true)
    try {
      const fd = new FormData()
      fd.append('text', submitText)
      fd.append('keep_file', keepFile ? '1' : '0')
      if (submitFile) fd.append('file', submitFile)
      await api.putForm(`/thesis/rounds/${latest.id}`, fd)
      setPop(null)
      toast(`第 ${latest.round_no} 轮提交已更新 ✓`, 'success')
      loadRounds(curId)
    } catch (e) { toast(e.message, 'error') } finally { setSending(false) }
  }

  /* ---------- 老师：为学生建立项目 ---------- */
  const studentsWithout = students
    .filter((s) => !projects.some((p) => p.student_id === s.id))
    .sort((a, b) => String(a.student_no || '').localeCompare(String(b.student_no || '')))
  const createProject = async () => {
    if (!newStudent) return toast('请选择学生', 'error')
    try {
      const p = await api.post(`/thesis/projects/${newStudent}`)
      if (newTitle.trim()) await api.put(`/thesis/projects/${p.id}`, { title: newTitle.trim() })
      setPop(null)
      setNewStudent('')
      setNewTitle('')
      toast('论文项目已建立 ✓', 'success')
      await loadProjects()
      setCurId(p.id)
    } catch (e) { toast(e.message, 'error') }
  }

  /* ---------- 老师：修改已建项目（题目 / 阶段） ---------- */
  const openProjectEdit = () => {
    setProjTitle(cur?.title || '')
    setProjStage(cur?.stage || STAGES[0])
    setPop('proj')
  }

  const saveProject = async () => {
    if (!curId) return
    setSending(true)
    try {
      await api.put(`/thesis/projects/${curId}`, { title: projTitle.trim(), stage: projStage })
      setPop(null)
      toast(`${cur.student_name} 的论文信息已保存 ✓`, 'success')
      loadProjects()
    } catch (e) { toast(e.message, 'error') } finally { setSending(false) }
  }

  const attRow = (stored, orig, red) => {
    if (!stored) return null
    return (
      <div className="att-row">
        <span className={`att${red ? ' red' : ''}`} title="点击下载"
          onClick={(e) => {
            e.stopPropagation()
            downloadFile(stored, orig).then(() => toast(`已开始下载「${orig}」`, 'success')).catch((err) => toast(err.message, 'error'))
          }}>
          <span className="fi">⬇</span>{orig}
        </span>
      </div>
    )
  }

  return (
    <div className="pg-thesis">
      <div className="page">
        <ThesisBannerBridge />

        <div className="shelf">
          {/* 左：学生索引。学生端也保留这一栏（对称三栏），只是列表里只有自己一个人。
              student 的 projects 已在 loadProjects 里按 student_id 过滤过，点不出别人。 */}
            <aside className="binder">
              <span className="tape" />
              <div className="binder-head"><span className="clip">❏</span>{isTeacher ? '学生索引' : '我的档案'}</div>
              <div className="idx-list">
                {sorted.map((p, i) => (
                  <div key={p.id} className={`idx${p.id === curId ? ' active' : ''}`}
                    onClick={() => { setCurId(p.id); setRoundView('latest'); setReplyText(''); setReplyFile(null) }}>
                    <div className="avatar" style={{ '--ac1': AVATAR_COLORS[i % AVATAR_COLORS.length][0], '--ac2': AVATAR_COLORS[i % AVATAR_COLORS.length][1] }}>
                      {p.student_name[0]}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className="nm">{p.student_name}</div>
                      <div className="tt" title={p.title}>{p.title || '（未定题）'}</div>
                    </div>
                    <span className={`stage ${stageClass(p.stage)}`}>{p.stage}</span>
                  </div>
                ))}
                {projects.length === 0 && <div className="tt" style={{ padding: '10px 4px' }}>暂无论文项目</div>}
              </div>
              {/* 建项目是老师专属操作 */}
              {isTeacher && (
                <button className="add-proj" onClick={() => { setPop('create'); setNewStudent(''); setNewTitle('') }}>
                  <span className="plus">＋</span>为学生建立项目
                </button>
              )}
            </aside>

          {/* 中：多轮往返档案 */}
          <main className="archive">
            {!cur && <div className="empty">{isTeacher ? '从左侧选择一位学生，翻开他的论文档案。' : '还没有论文项目，请联系老师建立。'}</div>}


            {cur && (
              <>
                {/* 轮次总览 + 学生提交入口：操作的是这条往返流，所以留在中栏 */}
                <div className={`round-bar${isTeacher ? ' teacher-rounds' : ''}`}>
                  <div className="round-dots">
                    <span className="rl">轮次</span>
                    <span className={`rd txt${roundView === 'latest' ? ' on' : ''}`} title="只看当前（最新）一轮"
                      onClick={() => setRoundView('latest')}>当前</span>
                    {rounds.map((r) => {
                      const done = r.teacher_comment || r.teacher_file
                      return (
                        <span key={r.id} className={`rd ${done ? 'done' : 'wait'}${roundView === r.round_no ? ' on' : ''}`}
                          title={`第 ${r.round_no} 轮 · ${done ? '已批注' : '待批注'}（点击只看这一轮）`}
                          onClick={() => setRoundView(r.round_no)}>{r.round_no}</span>
                      )
                    })}
                    <span className={`rd txt${roundView === 'all' ? ' on' : ''}`} title="显示全部轮次"
                      onClick={() => setRoundView('all')}>全部</span>
                    <span className="rl view-tip">
                      正在显示：{roundView === 'all' ? `全部 ${rounds.length} 轮` : `第 ${shownRounds[0]?.round_no ?? '—'} 轮${roundView === 'latest' ? '（当前）' : ''}`}
                    </span>
                    {rounds.length === 0 && <span className="rl">暂无</span>}
                  </div>
                  {!isTeacher && (
                    <div className="lh-actions">
                      {pendingLatest ? (
                        <button className="round-action" onClick={openEditSubmit}>
                          <span className="pen">✎</span>修改本次提交（第 {latest.round_no} 轮）
                        </button>
                      ) : (
                        <button className="round-action"
                          onClick={() => { setPop('submit'); setSubmitText(''); setSubmitFile(null) }}>
                          <span className="pen">📮</span>提交第 {rounds.length + 1} 轮
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {loadingRounds && <div className="empty">正在翻开档案…</div>}

                {shownRounds.map((r, i) => {
                  const replied = r.teacher_comment || r.teacher_file
                  const isPendingLatest = !replied && r.round_no === Math.max(...rounds.map((x) => x.round_no))
                  return (
                    <section className="round" style={{ '--d': `${i * 0.1}s` }} key={r.id}>
                      <div className="round-head">
                        <span className={`seal${replied ? ' old' : ''}`}>第{r.round_no}轮</span>
                        <div>
                          <div className="rt">{replied ? '已完成往返' : '等待老师批注'}</div>
                          <div className="rs">
                            学生提交于 {fmt(r.submitted_at)}{replied ? ` · 批注于 ${fmt(r.feedback_at)}` : ''}
                          </div>
                        </div>
                        <span className="line" />
                      </div>

                      <div className="exchange">
                        <span className="arrow-x">⇄</span>
                        <div className="half half-sub">
                          <span className="half-tag">📮 学生提交</span>
                          <div className="tm">{fmt(r.submitted_at)}</div>
                          <div className="txt">{r.student_text || '（无文字说明）'}</div>
                          {attRow(r.student_file, r.student_file_orig, false)}
                        </div>

                        <div className="half half-rep">
                          {replied ? (
                            <>
                              <span className="stamp-done">已批注</span>
                              <span className="half-tag">🖊 老师批注</span>
                              <div className="tm">{fmt(r.feedback_at)}</div>
                              <div className="txt">{r.teacher_comment || '（仅回传了批注文件）'}</div>
                              {attRow(r.teacher_file, r.teacher_file_orig, true)}
                            </>
                          ) : isPendingLatest && isTeacher ? (
                            <>
                              <span className="half-tag">🖊 老师批注 · 进行中</span>
                              <div className="reply-form">
                                <textarea value={replyText} placeholder="用红笔写下本轮批注意见…"
                                  onChange={(e) => setReplyText(e.target.value)} />
                                {replyFile && (
                                  <div className="att-row">
                                    <span className="att red"><span className="fi">⬇</span>{replyFile.name}</span>
                                  </div>
                                )}
                                <div className="reply-foot">
                                  <button className="btn-attach" type="button" onClick={() => fileRef.current?.click()}>
                                    📎 添加批注附件
                                  </button>
                                  <input ref={fileRef} type="file" hidden
                                    onChange={(e) => setReplyFile(e.target.files?.[0] || null)} />
                                  <button className="btn-send" type="button" disabled={sending} onClick={sendReply}>
                                    <span className="pen">🖊</span>{sending ? '提交中…' : '提交批注'}
                                  </button>
                                </div>
                              </div>
                            </>
                          ) : (
                            <>
                              <span className="half-tag">🖊 老师批注</span>
                              <div className="pending">—— 本轮尚未批注 ——</div>
                            </>
                          )}
                        </div>
                      </div>
                    </section>
                  )
                })}

                {rounds.length === 0 && !loadingRounds && (
                  <div className="empty">还没有提交记录，等待学生交上第一轮材料。</div>
                )}
              </>
            )}
          </main>


          {/* 右：学生信息（竖排手账卡，滚动时吸顶） */}
          {cur && (
            <aside className="student-card">
              <span className="tape" />
              <div className="sc-avatar" style={{ '--ac1': ac[0], '--ac2': ac[1] }}>{cur.student_name[0]}</div>
              <h2>{cur.student_name}</h2>
              <div className="sc-sub">{cur.grade_name} · 学号 {cur.student_no || '—'}</div>

              <div className="sc-title">
                <span className="lab">THESIS TITLE · 论文题目</span>
                <b>《{cur.title || '未定题'}》</b>
                {isTeacher && (
                  <button className="lh-edit" type="button" title="修改论文题目与当前阶段"
                    onClick={openProjectEdit}>✎ 修改</button>
                )}
              </div>

              <dl className="sc-stats">
                <div><dt>往返轮次</dt><dd>{rounds.length} 轮</dd></div>
                <div><dt>已批注</dt><dd>{doneCount} 轮</dd></div>
                <div><dt>当前阶段</dt><dd>{cur.stage}</dd></div>
              </dl>
            </aside>
          )}
        </div>
      </div>

      {/* 弹层：建立项目 / 修改论文信息 / 提交新一轮 / 修改本次提交 */}
      <div className={`pop${pop ? ' open' : ''}`}>
        <div className="pop-bg" onClick={() => setPop(null)} />
        <div className="pop-card">
          <span className="tape" />
          {pop === 'create' && (
            <>
              <h3>为学生建立论文项目</h3>
              <div className="field">
                <label>学生</label>
                <select value={newStudent} onChange={(e) => setNewStudent(e.target.value)}>
                  <option value="">请选择学生</option>
                  {studentsWithout.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}（{s.student_no || '无学号'}）</option>
                  ))}
                </select>
                {studentsWithout.length === 0 && <div className="hint">所有学生都已建立项目</div>}
              </div>
              <div className="field">
                <label>论文题目（可稍后填写）</label>
                <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="如：基于图神经网络的异常检测研究" />
              </div>
              <div className="pop-actions">
                <button className="btn-ghost" type="button" onClick={() => setPop(null)}>取消</button>
                <button className="btn-primary" type="button" onClick={createProject}>✚ 建立项目</button>
              </div>
            </>
          )}
          {pop === 'edit' && (
            <>
              <h3>修改第 {latest?.round_no} 轮提交</h3>
              <div className="field">
                <label>本次修改说明</label>
                <textarea value={submitText} onChange={(e) => setSubmitText(e.target.value)}
                  placeholder="补充或修正本轮说明…" />
              </div>
              <div className="field">
                <label>附件</label>
                <div className="file-pick">
                  <button className="btn-attach" type="button"
                    onClick={() => document.getElementById('edit-file')?.click()}>📎 更换附件</button>
                  <span className="hint">
                    {submitFile ? submitFile.name : (latest?.student_file_orig ? `当前：${latest.student_file_orig}` : '暂无附件')}
                  </span>
                  <input id="edit-file" type="file" onChange={(e) => setSubmitFile(e.target.files?.[0] || null)} />
                </div>
                {latest?.student_file && !submitFile && (
                  <label className="keep-file">
                    <input type="checkbox" checked={keepFile} onChange={(e) => setKeepFile(e.target.checked)} />
                    保留原附件（取消勾选则删除）
                  </label>
                )}
              </div>
              <div className="pop-actions">
                <button className="btn-ghost" type="button" onClick={() => setPop(null)}>取消</button>
                <button className="btn-primary" type="button" disabled={sending} onClick={saveEditSubmit}>
                  {sending ? '保存中…' : '保存修改'}
                </button>
              </div>
            </>
          )}
          {pop === 'proj' && (
            <>
              <h3>修改论文信息 · {cur?.student_name}</h3>
              <div className="field">
                <label>论文题目</label>
                <input value={projTitle} autoFocus
                  onChange={(e) => setProjTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveProject() }}
                  placeholder="如：基于图神经网络的异常检测研究" />
                <div className="hint">留空则显示为「未定题」</div>
              </div>
              <div className="field">
                <label>当前阶段</label>
                <select value={projStage} onChange={(e) => setProjStage(e.target.value)}>
                  {stageOptions(projStage).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <div className="hint">学号 {cur?.student_no || '—'} · {cur?.grade_name}</div>
              </div>
              <div className="pop-actions">
                <button className="btn-ghost" type="button" onClick={() => setPop(null)}>取消</button>
                <button className="btn-primary" type="button" disabled={sending} onClick={saveProject}>
                  {sending ? '保存中…' : '保存'}
                </button>
              </div>
            </>
          )}
          {pop === 'submit' && (
            <>
              <h3>提交第 {rounds.length + 1} 轮</h3>
              <div className="field">
                <label>本次修改说明</label>
                <textarea value={submitText} onChange={(e) => setSubmitText(e.target.value)}
                  placeholder="简述本轮修改内容…" />
              </div>
              <div className="field">
                <label>附件（PDF / Word / 压缩包）</label>
                <div className="file-pick">
                  <button className="btn-attach" type="button"
                    onClick={() => document.getElementById('submit-file')?.click()}>📎 选择文件</button>
                  <span className="hint">{submitFile ? submitFile.name : '未选择文件'}</span>
                  <input id="submit-file" type="file" onChange={(e) => setSubmitFile(e.target.files?.[0] || null)} />
                </div>
              </div>
              <div className="pop-actions">
                <button className="btn-ghost" type="button" onClick={() => setPop(null)}>取消</button>
                <button className="btn-primary" type="button" disabled={sending} onClick={submitRound}>
                  {sending ? '提交中…' : '提交'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
