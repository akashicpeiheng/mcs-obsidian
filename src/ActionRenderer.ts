import {paletteKey,type CanvasPalette} from './palette';
export interface ActionShape {inputs:{x:number;y:number}[];joint:{x:number;y:number};end:{x:number;y:number};jointInputs:number}
type Color=[number,number,number,number];
type Point={x:number;y:number};
const ring=Array.from({length:17},(_,i)=>({x:Math.cos(i*Math.PI/8),y:Math.sin(i*Math.PI/8)}));

// Batched GPU triangles for public actions; editable formal edges stay in SVG.
// Rendering receives derived positions only and cannot change M, E or evidence.
// 四个色值全部来自 CanvasPalette（theme.css 的 --mcs-* 镜像），本文件不写字面色。
export class ActionRenderer {
  private gl:WebGLRenderingContext|null;
  private program:WebGLProgram|null=null;
  private buffer:WebGLBuffer|null=null;
  private vertices=new Float32Array(1024*1024);
  private length=0;
  private color:Color=[0,0,0,1];
  private paletteKey='';
  private background:Color=[1,1,1,1];
  private accent:Color=[.1,.5,.4,1];
  private neutral:Color=[.54,.61,.58,1];
  private failure:Color=[.72,.31,.31,1];
  private lost=(e:Event)=>{e.preventDefault();};
  private restored=()=>{this.init();this.repaint();};
  constructor(private canvas:HTMLCanvasElement,private repaint:()=>void){
    this.gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:true});
    if(this.gl){this.init();canvas.addEventListener('webglcontextlost',this.lost);canvas.addEventListener('webglcontextrestored',this.restored);}
  }
  private init(){
    const gl=this.gl!;
    const shader=(type:number,source:string)=>{const shader=gl.createShader(type)!;gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader)??'行动绘制着色器无法编译');return shader;};
    const vertex=shader(gl.VERTEX_SHADER,'attribute vec2 p;attribute vec4 color;uniform vec2 size;varying vec4 rgba;void main(){gl_Position=vec4(p.x/size.x*2.0-1.0,1.0-p.y/size.y*2.0,0.0,1.0);rgba=color;}');
    const fragment=shader(gl.FRAGMENT_SHADER,'precision mediump float;varying vec4 rgba;void main(){gl_FragColor=rgba;}');
    this.program=gl.createProgram()!;gl.attachShader(this.program,vertex);gl.attachShader(this.program,fragment);gl.linkProgram(this.program);gl.deleteShader(vertex);gl.deleteShader(fragment);
    if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(this.program)??'行动绘制程序无法连接');
    this.buffer=gl.createBuffer();gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);this.paletteKey='';
  }
  private cssColor(value:string):Color{
    const ctx=document.createElement('canvas').getContext('2d',{willReadFrequently:true})!;ctx.fillStyle=value;ctx.fillRect(0,0,1,1);const p=ctx.getImageData(0,0,1,1).data;return [p[0]/255,p[1]/255,p[2]/255,p[3]/255];
  }
  private coordinate(x:number,y:number){
    if(this.length+6>this.vertices.length){const grown=new Float32Array(this.vertices.length*2);grown.set(this.vertices);this.vertices=grown;}
    const a=this.vertices,i=this.length,c=this.color;a[i]=x;a[i+1]=y;a[i+2]=c[0];a[i+3]=c[1];a[i+4]=c[2];a[i+5]=c[3];this.length+=6;
  }
  private triangle(a:Point,b:Point,c:Point){this.coordinate(a.x,a.y);this.coordinate(b.x,b.y);this.coordinate(c.x,c.y);}
  private line(a:Point,b:Point,width:number){const distance=Math.max(.001,Math.hypot(b.x-a.x,b.y-a.y)),x=(b.y-a.y)/distance*width/2,y=(a.x-b.x)/distance*width/2,p={x:a.x+x,y:a.y+y},q={x:a.x-x,y:a.y-y},r={x:b.x+x,y:b.y+y},s={x:b.x-x,y:b.y-y};this.triangle(p,q,r);this.triangle(q,s,r);}
  private circle(p:Point,radius:number,fill:boolean){
    for(let i=0;i<16;i++){const a=ring[i],b=ring[i+1],outer=fill?radius:radius+.5,ux=p.x+a.x*outer,uy=p.y+a.y*outer,vx=p.x+b.x*outer,vy=p.y+b.y*outer;
      if(fill){this.coordinate(p.x,p.y);this.coordinate(ux,uy);this.coordinate(vx,vy);}else{const inner=Math.max(0,radius-.5),xx=p.x+a.x*inner,xy=p.y+a.y*inner,yx=p.x+b.x*inner,yy=p.y+b.y*inner;this.coordinate(ux,uy);this.coordinate(xx,xy);this.coordinate(vx,vy);this.coordinate(xx,xy);this.coordinate(yx,yy);this.coordinate(vx,vy);}
    }
  }
  draw(batches:Iterable<[string,ActionShape[]]>,camera:{x:number;y:number;scale:number},size:{width:number;height:number},palette:CanvasPalette){
    const gl=this.gl;if(!gl)return false;if(gl.isContextLost())return true;
    const ratio=Math.min(window.devicePixelRatio||1,2),width=Math.max(1,Math.round(size.width*ratio)),height=Math.max(1,Math.round(size.height*ratio));if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
    // 缓存键含全部四个令牌：明暗切换时键必然改变，色值随主题重建。
    const key=paletteKey(palette);if(key!==this.paletteKey){this.background=this.cssColor(palette.background);this.accent=this.cssColor(palette.accent);this.neutral=this.cssColor(palette.neutral);this.failure=this.cssColor(palette.failure);this.paletteKey=key;}
    this.length=0;const entries=[...batches],point=(p:Point)=>({x:Math.round(camera.x*10)/10+p.x*camera.scale,y:Math.round(camera.y*10)/10+p.y*camera.scale});
    const color=(kind:string):Color=>{const base=kind==='failed'?this.failure:kind==='active'?this.accent:this.neutral;return [base[0],base[1],base[2],kind==='dimmed'?.08:kind==='idle'?.55:1];};
    let count=0;for(const [kind,shapes]of entries){this.color=color(kind);const width=kind==='active'||kind==='failed'?2.5:1.25;for(const shape of shapes){count++;const j=point(shape.joint);for(const input of shape.inputs)this.line(point(input),j,width);this.line(j,point(shape.end),width);}}
    for(const [kind,shapes]of entries){const ink=color(kind);for(const shape of shapes){const j=point(shape.joint),end=point(shape.end),radius=8*Math.max(camera.scale,.7);this.color=this.background;this.circle(j,radius,true);this.color=ink;this.circle(j,radius,false);
      if(shape.jointInputs>1){this.line({x:j.x-radius/2,y:j.y+radius/2},{x:j.x,y:j.y-radius/2},1.2);this.line({x:j.x,y:j.y-radius/2},{x:j.x+radius/2,y:j.y+radius/2},1.2);}else this.circle(j,radius/8,true);
      const distance=Math.max(.001,Math.hypot(end.x-j.x,end.y-j.y)),x=(end.x-j.x)/distance,y=(end.y-j.y)/distance;this.triangle(end,{x:end.x-x*7-y*3,y:end.y-y*7+x*3},{x:end.x-x*7+y*3,y:end.y-y*7-x*3});
    }}
    gl.viewport(0,0,width,height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,this.vertices.subarray(0,this.length),gl.STREAM_DRAW);
    const position=gl.getAttribLocation(this.program!,'p'),rgba=gl.getAttribLocation(this.program!,'color');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,24,0);gl.enableVertexAttribArray(rgba);gl.vertexAttribPointer(rgba,4,gl.FLOAT,false,24,8);gl.uniform2f(gl.getUniformLocation(this.program!,'size'),size.width,size.height);gl.drawArrays(gl.TRIANGLES,0,this.length/6);
    this.canvas.dataset.edgeCount=String(count);this.canvas.dataset.renderer='webgl';this.canvas.dataset.palette=key;return true;
  }
  dispose(){this.canvas.removeEventListener('webglcontextlost',this.lost);this.canvas.removeEventListener('webglcontextrestored',this.restored);if(this.gl){this.gl.deleteBuffer(this.buffer);this.gl.deleteProgram(this.program);if(!this.gl.isContextLost())this.gl.getExtension('WEBGL_lose_context')?.loseContext();this.gl=null;}}
}
