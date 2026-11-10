/* ============================================================
 *  助手层（让 Agent 真的"听得懂"，而不是什么都当短剧拍）
 *  ------------------------------------------------------------
 *  1) ASSISTANT_SYSTEM：对话式系统提示，先理解再动手
 *  2) wantsProduction：判断这句话是「要做片」还是「在问事」
 *  3) extractDocument：读 txt/md/csv/json/docx（docx 用浏览器原生解压，无需依赖）
 * ============================================================ */

export const ASSISTANT_SYSTEM = `你是「林的视频工作台」的创作助手，像一位懂行的同事在跟用户聊天。
请严格按这些规则说话：
1. 先判断用户到底想干什么，再用大白话回答。不要输出 JSON，不要一上来就甩一堆步骤。
2. 用户在问「这是什么 / 怎么做 / 为什么 / 有什么区别 / 帮我看看 / 分析一下 / 总结 / 翻译」这类问题，就直接回答，**不要启动短剧生产流程**。
3. 用户给出创意、想拍片时：先用一句话复述你的理解，再说明你建议的交付物（短片 / 分镜 / 图片），然后问**最多一个**关键问题（比如时长、比例、风格）；用户说「直接做」才开工。
4. 信息不够或有歧义，直接说「我不确定」，并给两个具体选项让用户选，不要自己编。
5. 用户传了图片，就真的看着图说：描述画面、指出问题、或按图片内容给建议；用户传了文档，就基于文档里的内容回答，能引用原句就引用，别泛泛而谈。
6. 中文口语回答，句子短。三句话能说清就别写八句。不要用「作为 AI」「很高兴为您服务」这类客套。
7. 涉及本平台功能（图片/视频生成、无限画布、剧情短片、会员与积分）时，给具体可点的操作路径。`;

/* 判断这句话是「要做片」还是「在问事」
   默认偏向「问事」——先理解，用户说「直接做」再进流水线 */
export function wantsProduction(text = '') {
  const t = String(text).trim();
  if (!t) return false;
  if (/(只聊天|别做片|先别做|不用做片|只回答|不要生成|先别生成)/.test(t)) return false;
  if (/(直接做|开始做|开工|开跑|生成吧|就按这个做)/.test(t)) return true;

  const ASK = /(怎么|为什么|如何|是什么|啥意思|吗[？?]?$|分析|总结|解释|翻译|区别|优缺点|建议|值得|帮我看看|读一下|看一下|提炼|有没有|能不能|可不可以)/;
  const PROD = /(做片|拍一条|拍个|生成视频|出片|开机|短剧|分镜|故事板|成片|镜头|剧本|预告片|MV)/;

  const ask = ASK.test(t);
  const prod = PROD.test(t);
  if (ask && !prod) return false;      /* 纯提问 */
  if (prod && !ask) return true;       /* 纯要做片 */
  return false;                        /* 都命中或都没命中：先当聊天，别乱开流水线 */
}

/* ---------- 文档抽取 ---------- */
const TEXT_EXT = ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'yaml', 'yml', 'html', 'htm', 'js', 'css', 'ts', 'xml'];

function xml2text(xml) {
  return String(xml)
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* docx 就是个 zip：找到 word/document.xml，用浏览器自带解压流解开，剥掉标签 */
async function readDocx(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  const min = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('这个 docx 打不开（可能不是标准 docx）');

  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const compSize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const localOff = dv.getUint32(off + 42, true);
    const name = new TextDecoder().decode(buf.subarray(off + 46, off + 46 + nameLen));
    if (name === 'word/document.xml') {
      const lNameLen = dv.getUint16(localOff + 26, true);
      const lExtra = dv.getUint16(localOff + 28, true);
      const start = localOff + 30 + lNameLen + lExtra;
      const data = buf.subarray(start, start + compSize);
      let xml = '';
      if (method === 0) {
        xml = new TextDecoder().decode(data);
      } else {
        const ds = new DecompressionStream('deflate-raw');
        const stream = new Blob([data]).stream().pipeThrough(ds);
        xml = await new Response(stream).text();
      }
      return xml2text(xml);
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('docx 里没找到正文');
}

/* 统一入口：返回 {name, text}；不支持的类型抛中文错误 */
export async function extractDocument(file) {
  const ext = String(file.name || '').split('.').pop().toLowerCase();
  if (ext === 'docx') {
    const text = await readDocx(file);
    if (!text) throw new Error('这个 docx 里没有可读的文字');
    return { name: file.name, text: text.slice(0, 20000) };
  }
  if (ext === 'doc') throw new Error('老的 .doc 格式读不了，请另存为 .docx 再上传');
  if (ext === 'pdf') throw new Error('PDF 暂时读不了，可以把要点复制成文本，或另存为 .docx 再上传');
  if (TEXT_EXT.includes(ext) || String(file.type || '').startsWith('text/')) {
    const t = await file.text();
    if (!t.trim()) throw new Error('这个文件是空的');
    return { name: file.name, text: t.slice(0, 20000) };
  }
  throw new Error('暂不支持 .' + ext + ' 这类文件，请用 txt / md / csv / json / docx');
}
