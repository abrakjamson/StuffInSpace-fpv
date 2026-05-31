uniform float fNightScale;
uniform vec3 v3LightPosition;
uniform sampler2D tDiffuse;
uniform sampler2D tDiffuseNight;
varying vec3 c0;
varying vec3 c1;
varying vec3 vNormal;
varying vec2 vUv;
void main (void)
{
    vec3 diffuseTex = texture2D( tDiffuse, vUv ).xyz;
    vec3 diffuseNightTex = texture2D( tDiffuseNight, vUv ).xyz;
    float sunlight = dot(normalize(vNormal), normalize(v3LightPosition));
    float terminator = smoothstep(-0.12, 0.18, sunlight);
    vec3 definedDay = clamp((pow(diffuseTex, vec3(0.85)) - 0.5) * 1.35 + 0.5, 0.0, 1.0);
    vec3 day = definedDay * (0.16 + 1.08 * terminator);
    vec3 night = fNightScale * diffuseNightTex * (1.0 - terminator);
    vec3 limbAtmosphere = vec3(0.04, 0.12, 0.24) * pow(max(0.0, 1.0 - abs(sunlight)), 2.0);
    gl_FragColor = vec4(day + night + limbAtmosphere, 1.0);
}