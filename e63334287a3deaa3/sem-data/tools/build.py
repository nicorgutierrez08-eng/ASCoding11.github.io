#!/usr/bin/env python3
"""
Builds the data for the Back Room's two daily meaning games, Nearword and Warmer, from real word vectors.
It is run once by hand (it is not part of the site) and writes, into the sem-data folder:

  words.txt     the guessable words, one per line, in alphabetical order (line n is word number n); a word ending
                in '*' can be guessed but the game never shows it by itself (see SOFT)
  d/NNN.bin     one file per secret word (zlib-compressed), see "File format" below
  (it also prints spot checks and sizes)

Sources (downloaded once by hand into one folder, given as --src; none of them is committed):
  * GloVe 6B 300d vectors (Wikipedia 2014 + Gigaword 5, 400,000 lowercase words), Stanford NLP Group,
    Public Domain Dedication and License (PDDL). The copy used was Hugging Face's
    sentence-transformers/average_word_embeddings_glove.6B.300d, which is the same vectors as a safetensors file:
      <src>/model.safetensors                      (0_WordEmbeddings/model.safetensors, 480 MB)
      <src>/vocab.json                             (0_WordEmbeddings/whitespacetokenizer_config.json)
    Download: https://huggingface.co/sentence-transformers/average_word_embeddings_glove.6B.300d/resolve/main/<path>
  * SCOWL word lists via the npm package wordlist-english 1.2.1 (MIT; SCOWL's own permissive copyright notices
    are kept in ../SCOWL-Copyright.txt), used to keep real lowercase dictionary words and drop names, abbreviations and junk:
      <src>/wl/english-words-{10,20,35,40,50}.json and american-words-{10,20,35,40,50}.json
    Download: https://cdn.jsdelivr.net/npm/wordlist-english@1.2.1/<file>
  * Two lists of rude words, used only to leave words OUT (they are not copied anywhere):
      <src>/bad/ldnoobw.txt   https://cdn.jsdelivr.net/gh/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words@master/en
      <src>/bad/lang.json     https://cdn.jsdelivr.net/npm/bad-words@3.0.4/lib/lang.json
    plus the HARD list below (never guessable) and the SOFT list (guessable, never shown by the game itself).

Run:  python3 -I build.py --src <folder with the downloads> --out <the sem-data folder>
Needs Python 3 and numpy. Takes under a minute. With the same inputs it writes byte-identical files. If the number
of secret words changes, change COUNT in ../sem.js to match (and expect future daily words to change).

Vocabulary: SCOWL words of size 40 or less (common words) that are plain lowercase letters and in GloVe, ordered by
how common they are in GloVe's corpus; the first VOCAB of them, plus the EXTRA words (everyday words that news text
undercounts) and every secret word. Rude and sensitive words are left out.

Similarity: cosine similarity of the GloVe vectors (each vector scaled to length 1). The secret word itself is 1.0.

File format (after zlib inflate), little-endian:
  0   'S' 'M' version(2) 0
  4   u16 V (number of guessable words; must match words.txt)   6  u16 T (words ranked exactly, 1000)
  8   u8 L (number of levels), 3 x 0
  12  (L+1) x u16 level bounds by rank: level j holds the words ranked bound[j]+1 .. bound[j+1] (bound[0] = T, bound[L] = V)
      L x i16 the average similarity of each level's words, times 10000
      T bytes: high bytes of the top T word numbers, best first (the first is the secret itself)
      T bytes: their low bytes
      T x u16 similarity steps: s[0] = 10000 - round(10000*cos[0]), s[i] = round(10000*cos[i-1]) - round(10000*cos[i])
      V bytes: every word's level (by word number); 255 = in the top T
  The four parts after the header are deflated as separate Huffman-only blocks (the data has no repeats to find).
"""
import argparse, json, os, random, re, struct, sys, zlib
import numpy as np

VOCAB = 22000          # common words taken in frequency order (before EXTRA and the secrets are added)
T = 1000               # words ranked exactly for each secret
# Words past the top T are put in levels by rank: level j holds the words ranked LEVELS[j]+1 .. LEVELS[j+1]
# (the last level ends at the number of words). The game shows the middle rank of the level and the level's
# average similarity, so ranks past 1,000 are rounded more and more the further away they are.
LEVELS = [1000, 1200, 1400, 1600, 1800, 2000, 2300, 2600, 3000, 3500, 4000, 4750, 5500, 6500, 8000, 10000, 13000]
SEED = 'warmer-nearword-2026'

# Daily secret words: common, concrete-ish, school-friendly nouns, verbs and adjectives (chosen by hand).
SECRETS = """
ocean river mountain forest desert island beach volcano valley lake waterfall cloud rain snow storm thunder
lightning wind moon planet comet galaxy sky sunset flower tree leaf grass garden seed branch rock stone sand mud ice
fire wave tide cave cliff meadow jungle swamp glacier canyon earthquake tornado hurricane fog breeze dog cat horse
cow pig sheep goat chicken duck rabbit mouse lion bear wolf deer elephant monkey zebra whale dolphin shark fish
octopus turtle frog snake lizard owl parrot ant spider crab squirrel kangaroo puppy insect feather nest egg bread
cheese butter milk banana orange lemon strawberry cherry peach pear potato tomato carrot onion garlic pepper salt
sugar honey chocolate cookie cake pie pizza pasta rice soup salad sandwich burger coffee tea juice breakfast lunch
dinner kitchen oven spoon popcorn candy vanilla cinnamon pumpkin corn bean house door window roof floor chair table
bed pillow lamp candle mirror clock ladder towel bath shower sofa carpet garage fence gate bridge tower castle
palace school library museum hospital factory farm barn village city street road tunnel train car bus truck bicycle
boat ship plane rocket helmet umbrella camera phone computer keyboard robot book pencil puzzle doll balloon drum
guitar piano violin trumpet music dance painting poem newspaper teacher student doctor nurse farmer pilot chef
artist singer king queen prince princess wizard pirate detective baby child friend family mother father brother
sister grandmother neighbor hero ghost monster dragon heart eye ear nose mouth tooth hair finger leg knee brain
shirt dress hat coat jacket shoe scarf necklace crown birthday holiday wedding vacation journey adventure treasure
secret dream memory homework exam science history soccer basketball baseball tennis swimming trophy medal champion
victory winter summer spring autumn morning night weekend jump laugh cry smile sleep cook bake throw hide search
travel explore teach learn listen speak shout whisper remember forget shine melt freeze burn clean wash fix invent
happy sad angry brave calm quiet loud bright warm ancient dirty sweet sour bitter salty spicy frozen purple green
blue red yellow pink gentle clever funny hungry proud friendly beautiful colorful wild peaceful electricity internet
television telescope microscope laboratory experiment diamond run fly hot cold dark light grow build write read eat
sing swim climb story song movie gold silver glass wood wet dry dinosaur tractor helicopter jewel kingdom harbor
marble ribbon skeleton statue temple tent throne wagon whistle zoo circus carnival concert festival parade picnic
camping fishing hiking skiing surfing blizzard drought flood sunrise orbit eclipse asteroid oxygen fossil costume
mask recipe dessert soda lemonade sauce bakery grocery restaurant hotel airport stadium theater classroom playground
""".split()

# Everyday words that news-heavy GloVe frequencies undercount; kept guessable even if they fall past VOCAB.
EXTRA = """
kitten kittens crayon crayons marshmallow marshmallows pancake pancakes snowman snowmen toothbrush toothpaste giraffe
giraffes hamster hamsters cupcake cupcakes skateboard trampoline sandcastle lollipop popsicle pinecone acorn acorns
ladybug ladybugs caterpillar caterpillars tadpole tadpoles hedgehog hedgehogs raccoon raccoons chipmunk platypus
koala koalas panda pandas sloth flamingo flamingos peacock walrus starfish jellyfish seahorse lobster lobsters
cocoon beehive anthill sunflower sunflowers dandelion daisy daisies tulip tulips cactus mushroom mushrooms acorn
pebble pebbles puddle puddles icicle icicles snowflake snowflakes raindrop raindrops sunbeam moonlight starlight
backpack lunchbox notebook eraser erasers sharpener paintbrush stapler bookshelf bookcase bunk pajamas slipper
slippers mitten mittens earmuffs raincoat sneaker sneakers sandal sandals flashlight teapot kettle spatula ladle
whisk colander toaster blender doughnut doughnuts muffin muffins waffle waffles pretzel pretzels cereal oatmeal
spaghetti noodle noodles lasagna burrito taco tacos broccoli cauliflower cucumber zucchini blueberry blueberries
raspberry raspberries watermelon pineapple coconut apricot plum plums kiwi mango mangoes avocado lettuce spinach
celery radish pickle pickles sprinkles frosting icing custard pudding jelly jam syrup ketchup mustard mayonnaise
seesaw sandbox playground swing swings slide hopscotch yoyo marbles jigsaw teddy rattle cradle stroller crib
tricycle scooter wagon sled sledding snowball snowballs igloo campfire tent hammock canoe kayak paddle lifeguard
mermaid unicorn fairy fairies goblin elf elves troll wand spellbook potion cauldron broomstick astronaut spaceship
""".split()

# Never guessable, on top of the two downloaded lists (sexual words, slurs and rude words).
HARD = """
sex sexy sexual sexually sexuality sexes porn porno pornography pornographic erotic erotica nude nudes nudity
orgasm orgasms orgy orgies horny kinky fetish fetishes prostitute prostitutes prostitution brothel brothels hooker
hookers stripper strippers striptease pimp pimps rape raped rapes raping rapist rapists molest molested molester
molesters molesting incest pedophile pedophiles pedophilia condom condoms viagra genital genitals genitalia penis
penises vagina vaginal testicle testicles scrotum boob boobs nipple nipples arse semen sperm ejaculate ejaculation
fag fags faggot faggots dyke dykes tranny homo homos spic spics chink chinks gook gooks kike kikes wop wops dago
honky negro negroes coon coons darky jap japs paki retard retarded retards slut sluts whore whores dildo dildos
vibrator wank wanker twat cunt cock cocks dick dicks pussy pussies tit tits titty ass asses asshole assholes douche
douchebag pervert perverts perverted anal intercourse sodomy topless playboy bondage cumming fanny
""".split()

# Guessable, but the game never shows them itself (in hints or the closest-words list): drink, drugs, violence,
# insults and other words that are fine to type but shouldn't pop up unasked on a school site.
SOFT = """
crack cracks weed weeds stoned drunk drunken booze hangover vodka whiskey whisky tequila rum gin beer beers wine
wines liquor alcohol alcoholic cigarette cigarettes cigar cigars tobacco nicotine smoking cocaine heroin meth
marijuana cannabis hashish opium narcotic narcotics junkie junkies overdose suicide suicidal nazi nazis hitler slave
slaves slavery lynch lynching terrorist terrorists terrorism massacre massacres genocide holocaust behead beheaded
beheading torture tortured kill kills killed killer killers killing killings murder murdered murderer murderers
murders slaughter slaughtered gun guns gunman gunmen shoot shoots shooting shootings shot shots shooter shooters
stab stabbed stabbing corpse corpses bloody damn damned dammit hell crap crappy piss pissed idiot idiots moron
morons dumb stupid loser losers jerk jerks freak freaks savage savages lame cripple crippled midget midgets gypsy
gypsies redneck rednecks hick cracker crackers butt butts bum bums sucker suckers scum feces suck sucks sucked
sucking naked lust lusty breast breasts buttock buttocks crotch groin prick pricks bastard bastards bitch bitches
gay gays lesbian lesbians bra bras panties lingerie underwear bikini bikinis seductive seduce seduced kiss kissing
kisses kissed affair affairs mistress mistresses virgin virgins bomb bombs bombing bombings bomber bombers explosive
explosives grenade grenades rifle rifles pistol pistols ammunition bullet bullets weapon weapons knife knives
abort abortion abortions abuse abused abuser abusers abusive assault assaults assaulted drug drugs murdering gunshot
gunshots gunfire gunner bombed bombardment bombardments urine vomit vomiting lover lovers terror bloodshed warhead
warheads hostage hostages kidnap kidnapped kidnapping execution executed arson arsonist sniper snipers casualties
domination escort escorts snatch screw screws screwed knob knobs
""".split()

# In the downloaded lists but ordinary words, so kept as normal words. (The borderline ones that used to be here,
# domination, escort, snatch, screw and knob, are in SOFT now: fine to type, never shown by the game.)
ALLOW = set()

# Words containing these are never guessable either.
ROOTS = ['fuck', 'shit', 'cunt', 'nigg', 'porn', 'slut', 'whore', 'bitch', 'fagg', 'wank', 'twat', 'jizz', 'dildo',
         'asshole', 'penis', 'vagin', 'masturb', 'orgasm', 'pedoph', 'boob']
TWO = set('ad ah am an as at ax be by do eh ex go ha he hi ho id if in is it ma me my no of oh on or ow ox pa pi so '
          'to uh um up us we yo'.split())


def load_glove(src):
    vocab = json.load(open(os.path.join(src, 'vocab.json')))['vocab']
    path = os.path.join(src, 'model.safetensors')
    with open(path, 'rb') as f:
        n = struct.unpack('<Q', f.read(8))[0]
        hdr = json.loads(f.read(n))
    t = hdr['emb_layer.weight']
    assert t['dtype'] == 'F32' and t['shape'][0] == len(vocab), 'unexpected safetensors layout'
    M = np.memmap(path, dtype='<f4', mode='r', offset=8 + n + t['data_offsets'][0], shape=tuple(t['shape']))
    return vocab, M


def load_scowl(src):
    lev = {}
    for size in (50, 40, 35, 20, 10):
        for kind in ('english', 'american'):
            for w in json.load(open(os.path.join(src, 'wl', '%s-words-%d.json' % (kind, size)))):
                lev[w] = size
    return lev


def load_block(src):
    b = set(HARD)
    for line in open(os.path.join(src, 'bad', 'ldnoobw.txt'), encoding='utf-8'):
        line = line.strip().lower()
        if line:
            b.add(line)
    for w in json.load(open(os.path.join(src, 'bad', 'lang.json')))['words']:
        b.add(w.strip().lower())
    soft = set(SOFT) | (b & set(SOFT))
    b = (b - ALLOW - soft)
    return b, soft


def blocked(w, B):
    return w in B or any(r in w for r in ROOTS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    gv, M = load_glove(a.src)
    gi = {}
    for i, w in enumerate(gv):
        gi.setdefault(w, i)
    lev = load_scowl(a.src)
    B, SOFTSET = load_block(a.src)

    def ok(w, maxlev):
        return (lev.get(w, 99) <= maxlev and w in gi and re.fullmatch('[a-z]+', w) and (len(w) > 2 or w in TWO)
                and not blocked(w, B))

    common = sorted((w for w in lev if ok(w, 40)), key=lambda w: gi[w])[:VOCAB]
    words = set(common)
    for w in EXTRA:
        if ok(w, 50):
            words.add(w)
    secrets, seen = [], set()
    for w in SECRETS:
        if w in seen:
            continue
        seen.add(w)
        if not ok(w, 50) or w in SOFTSET:
            print('secret skipped (not usable):', w, file=sys.stderr)
            continue
        secrets.append(w)
        words.add(w)
    words = sorted(words)
    V = len(words)
    assert V < 65536
    num = {w: i for i, w in enumerate(words)}
    E = np.asarray(M[[gi[w] for w in words]], dtype=np.float64)
    E /= np.linalg.norm(E, axis=1, keepdims=True)

    rnd = random.Random(SEED)
    order = secrets[:]
    rnd.shuffle(order)
    os.makedirs(os.path.join(a.out, 'd'), exist_ok=True)
    with open(os.path.join(a.out, 'words.txt'), 'w', newline='\n') as f:
        f.write('\n'.join(w + ('*' if w in SOFTSET else '') for w in words) + '\n')
    bounds = LEVELS + [V]
    L = len(LEVELS)
    assert bounds[0] == T and all(x < y for x, y in zip(bounds, bounds[1:]))
    total = 0
    sizes = []
    for k, s in enumerate(order):
        c = E @ E[num[s]]
        c[num[s]] = 1.0
        rank = np.argsort(-c, kind='stable')
        assert rank[0] == num[s]
        top = rank[:T]
        lvl = np.full(V, 255, np.uint8)
        means = []
        for j in range(L):
            members = rank[bounds[j]:bounds[j + 1]]
            lvl[members] = j
            means.append(int(round(float(c[members].mean()) * 10000)))
        q = np.round(c[top] * 10000).astype(np.int64)
        steps = np.diff(np.concatenate([[10000], q])) * -1
        assert steps.min() >= 0 and steps.max() < 65536
        hdr = struct.pack('<2sBBHHB3x', b'SM', 2, 0, V, T, L) + struct.pack('<%dH' % (L + 1), *bounds) + \
            struct.pack('<%dh' % L, *means)
        raw = hdr + (top >> 8).astype(np.uint8).tobytes() + (top & 255).astype(np.uint8).tobytes() + \
            steps.astype('<u2').tobytes() + lvl.tobytes()
        # Huffman-only deflate (the data has no repeats worth finding), one block per section
        cut = [0, len(hdr) + T, len(hdr) + 2 * T, len(hdr) + 4 * T, len(raw)]
        zc = zlib.compressobj(9, zlib.DEFLATED, 15, 9, zlib.Z_HUFFMAN_ONLY)
        z = b''.join(zc.compress(raw[cut[i]:cut[i + 1]]) + zc.flush(zlib.Z_SYNC_FLUSH if i < 3 else zlib.Z_FINISH)
                     for i in range(4))
        assert zlib.decompress(z) == raw
        with open(os.path.join(a.out, 'd', '%03d.bin' % k), 'wb') as f:
            f.write(z)
        total += len(z)
        sizes.append(len(z))
    print('words', V, 'secrets', len(order), 'files total %.2f MB, mean %.1f KB, max %.1f KB' % (
        total / 1e6, total / len(order) / 1e3, max(sizes) / 1e3))
    print('words.txt %.1f KB' % (os.path.getsize(os.path.join(a.out, 'words.txt')) / 1e3))
    # spot checks
    for s in ['ocean', 'dog', 'winter', 'guitar', 'bread', 'happy', 'castle', 'run']:
        if s in num:
            c = E @ E[num[s]]
            r = np.argsort(-c, kind='stable')
            print(s, '->', ' '.join(words[i] for i in r[1:16]))


if __name__ == '__main__':
    main()
