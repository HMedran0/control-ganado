import { describe, expect, it } from 'vitest';

import { relativizeRelationships, sanitizeForExcelJs, stripComments } from './xlsx-sanitize.js';

const rels = (name: string, body: string) => ({
  name,
  data: Buffer.from(`<Relationships>${body}</Relationships>`),
});
const text = (entry: { data: Buffer }) => entry.data.toString('utf8');

describe('relativizeRelationships', () => {
  it('convierte las rutas absolutas en relativas a la carpeta de la parte dueña', () => {
    const [sheet, workbook, root] = relativizeRelationships([
      rels(
        'xl/worksheets/_rels/sheet2.xml.rels',
        '<Relationship Type="c" Target="/xl/comments/comment1.xml" Id="a"/><Relationship Type="v" Target="/xl/drawings/d.vml" Id="b"/>',
      ),
      rels(
        'xl/_rels/workbook.xml.rels',
        '<Relationship Target="/xl/worksheets/sheet1.xml" Id="r1"/><Relationship Target="styles.xml" Id="r2"/>',
      ),
      rels('_rels/.rels', '<Relationship Target="/xl/workbook.xml" Id="r1"/>'),
    ]);
    expect(text(sheet!)).toContain('Target="../comments/comment1.xml"');
    expect(text(sheet!)).toContain('Target="../drawings/d.vml"');
    expect(text(workbook!)).toContain('Target="worksheets/sheet1.xml"');
    expect(text(workbook!)).toContain('Target="styles.xml"');
    expect(text(root!)).toContain('Target="xl/workbook.xml"');
  });

  it('deja igual los vínculos externos y las demás partes', () => {
    const external = rels(
      'xl/worksheets/_rels/sheet1.xml.rels',
      '<Relationship TargetMode="External" Target="/https://example.com" Id="h"/>',
    );
    const sheet = { name: 'xl/worksheets/sheet1.xml', data: Buffer.from('<x Target="/y"/>') };
    const [same, other] = relativizeRelationships([external, sheet]);
    expect(same).toBe(external);
    expect(other).toBe(sheet);
  });
});

describe('stripComments', () => {
  it('quita los comentarios, los dibujos VML y lo que los enlaza, y deja lo demás', () => {
    const entries = [
      { name: 'xl/comments/comment1.xml', data: Buffer.from('<comments/>') },
      { name: 'xl/comments2.xml', data: Buffer.from('<comments/>') },
      { name: 'xl/drawings/commentsDrawing1.vml', data: Buffer.from('<xml/>') },
      { name: 'xl/drawings/drawing1.xml', data: Buffer.from('<wsDr/>') },
      rels(
        'xl/worksheets/_rels/sheet2.xml.rels',
        '<Relationship Type="http://x/relationships/comments" Target="/xl/comments/comment1.xml" Id="a"/><Relationship Type="http://x/relationships/vmlDrawing" Target="x.vml" Id="b"/><Relationship Type="http://x/relationships/drawing" Target="../drawings/drawing1.xml" Id="c"/>',
      ),
      {
        name: 'xl/worksheets/sheet2.xml',
        data: Buffer.from('<worksheet><sheetData/><legacyDrawing r:id="b"/></worksheet>'),
      },
    ];
    const result = stripComments(entries);
    expect(result.map((entry) => entry.name)).toEqual([
      'xl/drawings/drawing1.xml',
      'xl/worksheets/_rels/sheet2.xml.rels',
      'xl/worksheets/sheet2.xml',
    ]);
    expect(text(result[1]!)).toBe(
      '<Relationships><Relationship Type="http://x/relationships/drawing" Target="../drawings/drawing1.xml" Id="c"/></Relationships>',
    );
    expect(text(result[2]!)).toBe('<worksheet><sheetData/></worksheet>');
  });

  it('sanitizeForExcelJs aplica las dos cosas', () => {
    const [sheetRels] = sanitizeForExcelJs([
      rels(
        'xl/_rels/workbook.xml.rels',
        '<Relationship Type="w" Target="/xl/worksheets/sheet1.xml" Id="r1"/>',
      ),
    ]);
    expect(text(sheetRels!)).toContain('Target="worksheets/sheet1.xml"');
  });
});
