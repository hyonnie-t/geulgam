// 티스토리 임시저장 목록 뽑기 (2026-11-14)
// 내장 브라우저에서 https://0hyonnie.tistory.com/manage/posts 를 연 뒤(로그인된 상태) 이 파일 내용을 그대로
// javascript_tool로 실행한다. 나온 JSON 문자열을 그대로 웹앱\geulgam\tistory-drafts.local.json 에 저장한다(gitignore).
// 읽기만 한다. 글 본문은 저장하지 않고 제목·날짜·글자 수·표시 개수·첫 줄 140자만 남긴다.
(async () => {
  const list = (await (await fetch('/manage/drafts', { credentials: 'include' })).json()).data || [];
  const drafts = [];
  for (const d of list) {
    const one = (await (await fetch('/manage/drafts/' + d.sequence, { credentials: 'include' })).json()).draft || {};
    const html = one.content || '';
    const text = html.replace(/<\/(p|h\d|li|div|blockquote)>/g, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, ' ');
    // 맨 위 «[작업 메모 …]» 줄(★·☆ 설명)은 세지 않는다
    const work = text.split('\n').filter((l) => !/^\s*\[작업 메모/.test(l)).join('\n');
    // 이모지가 반으로 잘리지 않게 글자 단위(Array.from)로 자른다
    const head = Array.from(work.replace(/[★☆📌]/gu, '').replace(/\s+/g, ' ').trim()).slice(0, 140).join('');
    drafts.push({
      seq: d.sequence,
      title: d.title || '',
      created: (d.createdAt || '').slice(0, 10),
      updated: (d.updatedAt || '').slice(0, 10),
      minutes: Math.round((d.totalWritingTimeMs || 0) / 60000),
      chars: text.replace(/\s/g, '').length,
      imgs: (html.match(/<img|\[##_Image/g) || []).length,
      fill: (work.match(/★/g) || []).length,   // 효니가 직접 채울 곳
      guess: (work.match(/☆/g) || []).length,  // Claude가 추측한 문장(확인 필요)
      tags: d.tags ? String(d.tags).split(',').filter(Boolean).length : 0,
      cat: !!d.categoryId,
      head,
    });
  }
  return JSON.stringify({ v: 1, at: new Date().toISOString(), drafts });
})();
