#version 300 es
    precision highp float;
    precision highp int;
    precision highp sampler2D;
    in vec2 TexCoords;
    out vec4 outputColor;
    const vec2 halfCR = vec2(0.5, 0.5);

    // Custom vector types to handle higher dimenalities.
    struct ivec5
    {
      int x;
      int y;
      int z;
      int w;
      int u;
    };

    struct ivec6
    {
      int x;
      int y;
      int z;
      int w;
      int u;
      int v;
    };

    int imod(int x, int y) {
      return x - y * (x / y);
    }


    uniform sampler2D A;

      vec2 packedUVfrom2D(int texNumR, int texNumC, int texelsInLogicalRow, int row, int col) {
        int texelIndex = (row / 2) * texelsInLogicalRow + (col / 2);
        int texR = texelIndex / texNumC;
        int texC = texelIndex - texR * texNumC;
        return (vec2(texC, texR) + halfCR) / vec2(texNumC, texNumR);
      }

vec4 getA(int row, int col) {
      vec2 uv = packedUVfrom2D(2, 1, 1, row, col);
      return texture(A, uv);
    }
      vec4 getA(int b, int row, int col) {
        return getA(row, col);
      }

        ivec3 getOutputCoords() {
          ivec2 resTexRC = ivec2(TexCoords.xy *
                                vec2(4, 2));
          int index = resTexRC.y * 4 + resTexRC.x;
          int r = index / 8; index -= r * 8;int c = index / 2; int d = index - c * 2;
          return ivec3(r, c, d);
        }




    float getChannel(vec4 frag, int dim) {
      int modCoord = imod(dim, 2);
      return modCoord == 0 ? frag.r : frag.g;
    }

    float getChannel(vec4 frag, vec2 innerDims) {
      vec2 modCoord = mod(innerDims, 2.);
      return modCoord.x == 0. ?
        (modCoord.y == 0. ? frag.r : frag.g) :
        (modCoord.y == 0. ? frag.b : frag.a);
    }

        void main() {
          ivec3 rc = getOutputCoords();

          // Sample the texture with the coords to get the rgba channel value.
          vec4 packedInput = getA(rc.x,rc.y,rc.z);

          outputColor = vec4(getChannel(packedInput, vec2(rc.y,rc.z)), 0, 0, 0);
        }