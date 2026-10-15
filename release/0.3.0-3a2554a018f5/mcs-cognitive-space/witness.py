"""Independent replay of DEF provenance and bounded first-order finite tables.

Types and closed definitions use the existing Python ND kernel. Finite evaluation
is implemented here independently of the JavaScript evaluator. Not formally verified.
"""
import json
import sys
from pathlib import Path
sys.dont_write_bytecode = True
import kernel as k


def symbols(tree):
    if not isinstance(tree, list):
        return set()
    if tree and tree[0] == 'c':
        return {tree[1]}
    return set().union(*(symbols(x) for x in tree))


def acyclic(edges):
    done, active = set(), set()
    def visit(node):
        if node in done:
            return
        k.need(node not in active, '定义节点依赖循环')
        active.add(node)
        for target in edges.get(node, []):
            visit(target)
        active.remove(node)
        done.add(node)
    for node in list(edges):
        visit(node)


def reference(p):
    sig, definitions, axioms = k.environment(p['theory'])
    k.need(not axioms, '引用检查不能加入公理')
    for f in p['premises'] + [p['goal']]:
        k.formula_ok(f, sig)
        k.need(not k.formula_fv(f), '引用表达含未绑定变量')
    providers, refs = p['providers'], p['references']
    k.need(set(providers) == set(definitions), '来源符号与真实定义不一致')
    k.need(sig['constants'] == p['symbolTypes'], '定义体推断类型与登记类型不一致')
    for provider in providers.values():
        k.need(p['versions'].get(provider['node']) == provider['version'], '来源版本已过期')
    used, seen = symbols(p['goal']), set()
    for ref in refs:
        k.need(ref['symbol'] not in seen and ref['symbol'] in used, '引用重复或未实际使用')
        seen.add(ref['symbol'])
        k.need(providers.get(ref['symbol']) == {'node': ref['node'], 'version': ref['version']}, '来源不匹配')
        k.need(p['nodeVersions'].get(ref['node']) == ref['version'], '关系来源版本不匹配')
    k.need(used.intersection(providers) == seen, '遗漏实际使用的定义来源')
    edges = dict(p['nodeEdges'])
    # Reconstruct definition dependencies as well; a producer cannot erase them.
    for d in p['theory']['definitions']:
        a = providers[d['name']]['node']
        for n in symbols(d['term']).intersection(providers):
            b = providers[n]['node']
            if a != b:
                edges.setdefault(a, []).append(b)
    acyclic(edges)
    return {'references': refs}


def finite(p):
    sig, model = p['sig'], p['model']
    carrier, elements = model['carrier'], model['elements']
    k.need(carrier != 'o' and isinstance(carrier, str), '有限载体无效')
    k.need(isinstance(elements, list) and 1 <= len(elements) <= 8 and len(set(elements)) == len(elements)
           and all(isinstance(e, str) and e for e in elements), '载体须有 1–8 个互异元素')
    ops, consts = model['ops'], model['consts']
    k.need(not set(ops).intersection(consts), '运算与常元重名')
    k.need(set(ops).union(consts) == set(sig['constants']) and len(sig['constants']) <= 32, '模型须完整解释每个声明')
    for n, value in consts.items():
        k.need(sig['constants'][n] == carrier and value in elements, '常元类型或取值无效')
    arities = {}
    for n, op in ops.items():
        k.need(op['type'] == sig['constants'][n], '表的类型与签名不匹配')
        ty, arity = sig['constants'][n], 0
        while isinstance(ty, list) and len(ty) == 3 and ty[0] == '->':
            k.need(ty[1] == carrier, '只支持单载体一阶运算')
            arity, ty = arity + 1, ty[2]
        k.need(arity in [1, 2] and ty == carrier, '只支持一元或二元闭运算')
        table = op['table']
        k.need(isinstance(table, list) and len(table) == len(elements), '表不完整')
        if arity == 1:
            k.need(all(x in elements for x in table), '表不闭合')
        else:
            k.need(all(isinstance(row, list) and len(row) == len(elements) and all(x in elements for x in row) for row in table), '表不完整或不闭合')
        arities[n] = arity
    index = {x: i for i, x in enumerate(elements)}
    ticks = 0
    def step():
        nonlocal ticks
        ticks += 1
        if ticks > 500000:
            raise k.CheckError('有限完整求值超出预算', 'unsupported')
    def term(t, env):
        step()
        if t[0] == 'v':
            k.need(t[2] == carrier and t[1] in env, '自由变量或类型不匹配')
            return env[t[1]]
        if t[0] == 'c':
            if t[1] in consts:
                return consts[t[1]]
            k.need(t[1] in ops, '未解释的符号')
            return (t[1], ())
        if t[0] == 'app':
            fn, arg = term(t[1], env), term(t[2], env)
            k.need(isinstance(fn, tuple) and arg in elements, '应用超出一阶边界')
            name, args = fn[0], fn[1] + (arg,)
            if len(args) < arities[name]:
                return (name, args)
            k.need(len(args) == arities[name], '应用元数错误')
            table = ops[name]['table']
            return table[index[args[0]]] if len(args) == 1 else table[index[args[0]]][index[args[1]]]
        raise k.CheckError('有限项超出一阶边界', 'unsupported')
    def evaluate(f, env):
        step()
        tag = f[0]
        if tag in ['true', 'false']:
            return tag == 'true'
        if tag == 'eq':
            a, b = term(f[1], env), term(f[2], env)
            k.need(a in elements and b in elements, '等式不能比较高阶函数')
            return a == b
        if tag in ['and', 'imp']:
            a, b = evaluate(f[1], env), evaluate(f[2], env)
            return a and b if tag == 'and' else not a or b
        if tag in ['all', 'ex']:
            k.need(f[1][2] == carrier, '量词载体不匹配')
            values = [evaluate(f[2], {**env, f[1][1]: value}) for value in elements]
            return all(values) if tag == 'all' else any(values)
        raise k.CheckError('有限公式超出边界', 'unsupported')
    for f in p['premises'] + [p['goal']]:
        k.formula_ok(f, sig)
        k.need(not k.formula_fv(f), '有限表达含开放变量')
    values, goal = [evaluate(f, {}) for f in p['premises']], evaluate(p['goal'], {})
    k.need(all(values), f'有限见证的输入假设不成立：{[i + 1 for i, x in enumerate(values) if not x]}')
    k.need(goal == (p['kind'] == 'instanceOf'), '实例结论不成立' if p['kind'] == 'instanceOf' else '结论仍为真；此表不是反模型')
    return {'premises': values, 'goal': goal}


def run():
    data = Path(sys.argv[1]).read_bytes()
    k.need(len(data) <= k.MAX_BYTES, '输入超出大小上限')
    p = json.loads(data)
    k.size_guard(p)
    payload_hash = k.digest(p)
    try:
        k.need(p['schema'] == 'mcs-witness/1', '不支持的见证协议')
        k.need(p['mode'] in ['reference', 'finite'], '不支持的见证模式')
        if p['mode'] == 'finite':
            k.need(p['kind'] in ['instanceOf', 'counterexampleTo'], '有限检查的关系类型无效')
        result = reference(p) if p['mode'] == 'reference' else finite(p)
        return {'status': 'passed', 'result': result, 'payloadHash': payload_hash,
                'checker': 'mcs-witness/1', 'checkerSha256': k.file_hash(__file__)}
    except k.CheckError as error:
        return {'status': error.status, 'message': str(error), 'payloadHash': payload_hash}


if __name__ == '__main__':
    try:
        print(json.dumps(run(), ensure_ascii=True))
    except Exception as error:
        print(json.dumps({'status': 'error', 'message': str(error)}, ensure_ascii=True))
        sys.exit(1)
