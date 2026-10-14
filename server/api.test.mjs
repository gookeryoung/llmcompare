import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from './api.mjs';

const HEADERS = [
  { key: 'title', label: '标题' },
  { key: 'content', label: '题干' },
  { key: 'tags', label: '标签' },
  { key: 'difficulty', label: '难度' },
];

describe('toCsv', () => {
  it('输出中文表头 + 数据行', () => {
    const csv = toCsv([{ title: 'T1', content: 'C1', tags: 'a|b', difficulty: 'easy' }], HEADERS);
    expect(csv.split('\n')).toEqual(['标题,题干,标签,难度', 'T1,C1,a|b,easy']);
  });

  it('含逗号/引号/换行的字段按 RFC 4180 转义', () => {
    const csv = toCsv([{ title: 'a,b', content: '他说"你好"', tags: '', difficulty: 'x\ny' }], HEADERS);
    expect(csv).toContain('"a,b"');
    expect(csv).toContain('"他说""你好"""');
    // 字段内的换行必须被引号包住：直接按 \n 切会切成多行，由 parseCsv 再还原
    expect(csv).toContain('"x\ny"');
    expect(csv.split('\n').length).toBeGreaterThan(2);
  });

  it('null / undefined 渲染为空字段', () => {
    const csv = toCsv([{ title: null, content: undefined, tags: '', difficulty: 'easy' }], HEADERS);
    expect(csv.split('\n')[1]).toBe(',,,easy');
  });
});

describe('parseCsv', () => {
  it('解析基础行', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('与 toCsv 往返一致（含转义字符与中文）', () => {
    const rows = [
      { title: '标题,带逗号', content: '多行\n内容', tags: '标签A|标签B', difficulty: 'medium' },
      { title: '引号"测试"', content: 'plain', tags: '', difficulty: 'hard' },
    ];
    const parsed = parseCsv(toCsv(rows, HEADERS));
    expect(parsed[0]).toEqual(['标题', '题干', '标签', '难度']);

    const body = parsed.slice(1);
    expect(body).toHaveLength(2);
    expect(body[0]).toEqual(['标题,带逗号', '多行\n内容', '标签A|标签B', 'medium']);
    expect(body[1][0]).toBe('引号"测试"');
    expect(body[1][3]).toBe('hard');
  });

  it('支持 CRLF 与 BOM（Excel 导出的常见形态）', () => {
    const text = '\uFEFF标题,题干\r\nA,B\r\n';
    expect(parseCsv(text)).toEqual([
      ['标题', '题干'],
      ['A', 'B'],
    ]);
  });

  it('丢弃全空行', () => {
    expect(parseCsv('a,b\n\n  \n')).toEqual([['a', 'b']]);
  });

  it('空输入返回空数组', () => {
    expect(parseCsv('')).toEqual([]);
  });
});
