#!/usr/bin/env python3
"""Robust asar extractor - extract only wanted top-level dirs or all."""
import struct, json, os, sys

def extract(asar_path, out_dir, include=None, exclude=('node_modules',)):
    f = open(asar_path, 'rb')
    f.read(4)  # uint32 = 4
    header_size = struct.unpack('<I', f.read(4))[0]
    f.read(4)
    json_size = struct.unpack('<I', f.read(4))[0]
    header = json.loads(f.read(json_size).decode('utf8'))
    data_offset = 8 + header_size
    print(f"header_size={header_size}, json_size={json_size}, data_offset={data_offset}")

    n_files = [0]; n_skip = [0]
    def walk(node, rel):
        for name, v in node.get('files', {}).items():
            p = os.path.join(rel, name)
            if include and p.split('/')[0] not in include:
                continue
            if 'files' in v:
                os.makedirs(os.path.join(out_dir, p), exist_ok=True)
                walk(v, p)
            elif 'size' in v:
                if exclude and any(p.startswith(e + '/') or p == e for e in exclude):
                    n_skip[0] += 1
                    continue
                dst = os.path.join(out_dir, p)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                if v.get('unpacked'):
                    continue
                f.seek(data_offset + int(v['offset']))
                with open(dst, 'wb') as w:
                    w.write(f.read(v['size']))
                n_files[0] += 1
    walk(header, '')
    print(f"extracted {n_files[0]} files, skipped {n_skip[0]} (excluded)")

if __name__ == '__main__':
    asar, out = sys.argv[1], sys.argv[2]
    include = sys.argv[3].split(',') if len(sys.argv) > 3 else None
    exclude = sys.argv[4].split(',') if len(sys.argv) > 4 else ('node_modules',)
    extract(asar, out, include, exclude)
