       COPY "defs.cpy".
       IDENTIFICATION DIVISION.
       PROGRAM-ID. R5.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       >>IF OS = 'CYGWIN'
       78 LIBTYPE VALUE 'DLL)'.
       >>ELIF OS = 'UNIX'
       78 LIBTYPE VALUE 'SO)'.
       >>ELSE
       78 LIBTYPE VALUE 'DYLIB)'.
       >>END-IF
       01 X PIC X.
       SCREEN SECTION.
       01 SC.
          05 LINE 1 COL 1 VALUE LIBTYPE.
          05 LINE 1 COL 9 VALUE 'AB'.
       PROCEDURE DIVISION.
           DISPLAY SC.
           GOBACK.
